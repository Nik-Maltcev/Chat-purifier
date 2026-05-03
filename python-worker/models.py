from pydantic import BaseModel
from typing import Optional
from datetime import datetime


class FetchMessagesRequest(BaseModel):
    chat_identifier: str
    messages_count: int
    account_id: int


class FetchMessagesResponse(BaseModel):
    title: Optional[str]
    username: Optional[str]
    members_count: Optional[int]
    messages: list[str]
    last_message_date: Optional[datetime]


class ErrorResponse(BaseModel):
    error: str
    detail: Optional[str] = None
    wait_seconds: Optional[int] = None
    account_id: Optional[int] = None
    code: Optional[str] = None
