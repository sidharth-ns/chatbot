"""add_updated_at_trigger

Revision ID: d79dcf8e91d2
Revises: 71c544390859
Create Date: 2026-04-13 19:23:46.491371

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd79dcf8e91d2'
down_revision: Union[str, None] = '71c544390859'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # Create a reusable trigger function that sets updated_at = now()
    op.execute("""
        CREATE OR REPLACE FUNCTION set_updated_at()
        RETURNS TRIGGER AS $$
        BEGIN
            NEW.updated_at = NOW();
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    # Fire the trigger on chat_sessions whenever it is updated directly
    op.execute("""
        CREATE TRIGGER trg_chat_sessions_updated_at
        BEFORE UPDATE ON chat_sessions
        FOR EACH ROW
        EXECUTE FUNCTION set_updated_at();
    """)

    # Also update chat_sessions.updated_at when a new message is inserted
    op.execute("""
        CREATE OR REPLACE FUNCTION update_session_on_message()
        RETURNS TRIGGER AS $$
        BEGIN
            UPDATE chat_sessions
               SET updated_at = NOW()
             WHERE id = NEW.session_id;
            RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;
    """)

    op.execute("""
        CREATE TRIGGER trg_messages_update_session
        AFTER INSERT ON messages
        FOR EACH ROW
        EXECUTE FUNCTION update_session_on_message();
    """)


def downgrade() -> None:
    op.execute("DROP TRIGGER IF EXISTS trg_messages_update_session ON messages;")
    op.execute("DROP FUNCTION IF EXISTS update_session_on_message();")
    op.execute("DROP TRIGGER IF EXISTS trg_chat_sessions_updated_at ON chat_sessions;")
    op.execute("DROP FUNCTION IF EXISTS set_updated_at();")
