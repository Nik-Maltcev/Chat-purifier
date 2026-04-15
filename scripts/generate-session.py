from telethon import TelegramClient
from telethon.sessions import StringSession
import asyncio

async def main():
    api_id = int(input("Введи API ID: ").strip())
    api_hash = input("Введи API Hash: ").strip()
    client = TelegramClient(StringSession(), api_id, api_hash)
    
    await client.connect()
    
    if not await client.is_user_authorized():
        print("\nСканируй QR код в Telegram:")
        print("Настройки → Устройства → Подключить устройство\n")
        
        from telethon.tl.functions.auth import ExportLoginTokenRequest, ImportLoginTokenRequest, AcceptLoginTokenRequest
        from telethon.tl.types.auth import LoginTokenMigrateTo, LoginTokenSuccess
        import base64
        import qrcode
        
        while True:
            result = await client(ExportLoginTokenRequest(
                api_id=api_id,
                api_hash=api_hash,
                except_ids=[]
            ))
            
            if isinstance(result, LoginTokenSuccess):
                break
                
            if isinstance(result, LoginTokenMigrateTo):
                await client._switch_dc(result.dc_id)
                result = await client(ImportLoginTokenRequest(result.token))
                if isinstance(result, LoginTokenSuccess):
                    break
            
            token = base64.urlsafe_b64encode(result.token).decode('utf-8')
            url = f"tg://login?token={token}"
            
            print("QR код (отсканируй телефоном):")
            qr = qrcode.QRCode(version=1, box_size=1, border=1)
            qr.add_data(url)
            qr.make(fit=True)
            qr.print_ascii(invert=True)
            print(f"\nИли открой ссылку: {url}\n")
            print("Ожидаю сканирование (30 сек)...\n")
            
            try:
                await asyncio.sleep(30)
            except:
                break
    
    session_string = client.session.save()
    
    print("\n" + "=" * 50)
    print("ГОТОВО! Session string:")
    print("=" * 50)
    print(session_string)
    print("=" * 50)
    
    await client.disconnect()

asyncio.run(main())
