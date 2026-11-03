import base64
import re
from getpass import getuser

from fastapi import APIRouter
from pydantic import BaseModel, Field, field_validator

from ..db import SessionLocal
from ..models import UserProfile

router = APIRouter(prefix='/api/profile')


class ProfileBody(BaseModel):
    display_name: str = Field(min_length=1, max_length=255)
    email: str = Field(default='', max_length=255)
    avatar: str = Field(default='', max_length=2800000)

    @field_validator('display_name', 'email', mode='before')
    @classmethod
    def trim(cls, value):
        return value.strip() if isinstance(value, str) else value

    @field_validator('email')
    @classmethod
    def email_format(cls, value):
        if value and not re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', value):
            raise ValueError('Invalid email address')
        return value

    @field_validator('avatar')
    @classmethod
    def avatar_format(cls, value):
        if not value:
            return value
        match = re.fullmatch(r'data:image/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)', value)
        if not match:
            raise ValueError('Invalid avatar image')
        data = base64.b64decode(match[2], validate=True)
        valid = (match[1] == 'png' and data.startswith(b'\x89PNG\r\n\x1a\n')) or (match[1] == 'jpeg' and data.startswith(b'\xff\xd8\xff')) or (match[1] == 'webp' and data[:4] == b'RIFF' and data[8:12] == b'WEBP')
        if not valid or len(data) > 2 * 1024 * 1024:
            raise ValueError('Invalid avatar image or image exceeds 2 MB')
        return value


@router.get('')
def get_profile():
    with SessionLocal() as session:
        item = session.get(UserProfile, 1)
        return {'display_name': item.display_name if item else getuser(), 'email': item.email if item else '', 'avatar': item.avatar if item else ''}


@router.put('')
def save_profile(body: ProfileBody):
    with SessionLocal.begin() as session:
        item = session.get(UserProfile, 1)
        if not item:
            item = UserProfile(id=1)
            session.add(item)
        for key, value in body.model_dump().items():
            setattr(item, key, value)
    return body.model_dump()
