from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.errors import SessionPasswordNeededError
import asyncio

async def main():
    api_id = int(input("Введи API ID: ").strip())
    api_hash = input("Введи API Hash: ").strip()

    client = TelegramClient(StringSession(), api_id, api_hash)
    await client.connect()

    if not await client.is_user_authorized():
        from telethon.tl.functions.auth import ExportLoginTokenRequest, ImportLoginTokenRequest
        from telethon.tl.types.auth import LoginTokenMigrateTo, LoginTokenSuccess
        import base64

        try:
            import qrcode
            has_qr = True
        except ImportError:
            has_qr = False
            print("pip install qrcode для QR в консоли (необязательно)\n")

        print("Сканируй QR в Telegram: Настройки > Устройства > Подключить устройство\n")

        while True:
            try:
                result = await client(ExportLoginTokenRequest(
                    api_id=api_id, api_hash=api_hash, except_ids=[]
                ))

                if isinstance(result, LoginTokenSuccess):
                    break

                if isinstance(result, LoginTokenMigrateTo):
                    await client._switch_dc(result.dc_id)
                    result = await client(ImportLoginTokenRequest(result.token))
                    if isinstance(result, LoginTokenSuccess):
                        break

                token = base64.urlsafe_b64encode(result.token).decode()
                url = f"tg://login?token={token}"

                if has_qr:
                    qr = qrcode.QRCode(box_size=1, border=1)
                    qr.add_data(url)
                    qr.make(fit=True)
                    qr.print_ascii(invert=True)

                print(f"URL: {url}\n")
                print("Жду сканирование (30 сек)...\n")

                await asyncio.sleep(30)

            except SessionPasswordNeededError:
                password = input("Введи 2FA пароль: ").strip()
                await client.sign_in(password=password)
                break
            except Exception as e:
                if "SESSION_PASSWORD_NEEDED" in str(e):
                    password = input("Введи 2FA пароль: ").strip()
                    await client.sign_in(password=password)
                    break
                raise

    print("\n" + "=" * 50)
    print("Session string:")
    print("=" * 50)
    print(client.session.save())
    print("=" * 50)

    await client.disconnect()

asyncio.run(main())
