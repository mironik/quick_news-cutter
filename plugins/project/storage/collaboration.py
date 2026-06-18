"""Collaboration foundation for offline newsroom work.

This module keeps the first multi-user layer small: identity, sessions,
presence, activity history and soft object locks. It does not introduce login
or permissions yet; those can be added on top of the same tables.
"""

from __future__ import annotations

import json
import time
from typing import Any
from uuid import uuid4

from .project_db import _connect, _connect_project, ensure_db, ensure_project_db


def _now() -> str:
    return time.strftime("%Y-%m-%d %H:%M:%S")


def _id(prefix: str) -> str:
    return f"{prefix}_{uuid4().hex}"


def _clean_text(value: Any, default: str = "") -> str:
    text = str(value or "").strip()
    return text or default


def _row_dict(row: Any) -> dict[str, Any]:
    return dict(row) if row else {}


def collab_db_health() -> dict[str, Any]:
    ensure_db()
    expected = {"users", "sessions"}
    with _connect() as conn:
        tables = {
            row["name"]
            for row in conn.execute(
                "SELECT name FROM sqlite_master WHERE type = 'table'"
            ).fetchall()
        }
    return {
        "status": "ok",
        "tables": {name: name in tables for name in sorted(expected)},
    }


def start_session(
    *,
    display_name: str,
    role: str = "editor",
    station_id: str = "",
    client_label: str = "",
    project_id: str = "",
) -> dict[str, Any]:
    ensure_db()
    now = _now()
    display_name = _clean_text(display_name, "QNC korisnik")
    role = _clean_text(role, "editor")
    station_id = _clean_text(station_id, "unknown-station")
    client_label = _clean_text(client_label, "")
    user_id = _id("usr")
    session_id = _id("ses")
    with _connect() as conn:
        conn.execute(
            """
            INSERT INTO users (user_id, display_name, role, active, created_at, updated_at)
            VALUES (?, ?, ?, 1, ?, ?)
            """,
            (user_id, display_name, role, now, now),
        )
        conn.execute(
            """
            INSERT INTO sessions
                (session_id, user_id, station_id, client_label, created_at, last_seen_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """,
            (session_id, user_id, station_id, client_label, now, now),
        )
        conn.commit()
    if project_id:
        ensure_project_db(project_id)
        with _connect_project(project_id) as conn:
            conn.execute(
                """
                INSERT INTO project_members (project_id, user_id, role, joined_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_id, user_id) DO UPDATE SET
                    role = excluded.role,
                    last_seen_at = excluded.last_seen_at
                """,
                (project_id, user_id, role, now, now),
            )
            conn.commit()
    return get_session(session_id)


def get_session(session_id: str) -> dict[str, Any]:
    ensure_db()
    session_id = _clean_text(session_id)
    if not session_id:
        return {}
    with _connect() as conn:
        row = conn.execute(
            """
            SELECT
                s.session_id,
                s.user_id,
                s.station_id,
                s.client_label,
                s.created_at,
                s.last_seen_at,
                u.display_name,
                u.role
            FROM sessions s
            JOIN users u ON u.user_id = s.user_id
            WHERE s.session_id = ?
            """,
            (session_id,),
        ).fetchone()
    return _row_dict(row)


def touch_session(session_id: str, project_id: str = "") -> dict[str, Any]:
    ensure_db()
    now = _now()
    session = get_session(session_id)
    if not session:
        raise KeyError(session_id)
    with _connect() as conn:
        conn.execute(
            "UPDATE sessions SET last_seen_at = ? WHERE session_id = ?",
            (now, session_id),
        )
        conn.commit()
    if project_id:
        ensure_project_db(project_id)
        with _connect_project(project_id) as conn:
            conn.execute(
                """
                INSERT INTO project_members (project_id, user_id, role, joined_at, last_seen_at)
                VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(project_id, user_id) DO UPDATE SET
                    last_seen_at = excluded.last_seen_at
                """,
                (project_id, session["user_id"], session["role"], now, now),
            )
            conn.commit()
    return get_session(session_id)


def list_presence(project_id: str, active_seconds: int = 120) -> list[dict[str, Any]]:
    ensure_db()
    project_id = _clean_text(project_id)
    cutoff = time.strftime(
        "%Y-%m-%d %H:%M:%S",
        time.localtime(time.time() - max(5, int(active_seconds))),
    )
    if project_id:
        ensure_project_db(project_id)
        with _connect_project(project_id) as conn:
            members = conn.execute(
                """
                SELECT project_id, user_id, role AS project_role, last_seen_at AS project_last_seen_at
                FROM project_members
                WHERE project_id = ? AND last_seen_at >= ?
                ORDER BY last_seen_at DESC
                """,
                (project_id, cutoff),
            ).fetchall()
        user_ids = [str(row["user_id"]) for row in members]
        users: dict[str, dict[str, Any]] = {}
        if user_ids:
            placeholders = ",".join("?" for _ in user_ids)
            with _connect() as conn:
                rows = conn.execute(
                    f"""
                    SELECT s.session_id, s.user_id, s.station_id, s.client_label,
                           s.last_seen_at, u.display_name, u.role
                    FROM users u
                    LEFT JOIN sessions s ON s.user_id = u.user_id
                    WHERE u.user_id IN ({placeholders})
                    """,
                    user_ids,
                ).fetchall()
            users = {str(row["user_id"]): dict(row) for row in rows}
        return [{**dict(row), **users.get(str(row["user_id"]), {})} for row in members]
    with _connect() as conn:
        rows = conn.execute(
            """
            SELECT
                '' AS project_id,
                u.role AS project_role,
                s.last_seen_at AS project_last_seen_at,
                s.session_id,
                s.user_id,
                s.station_id,
                s.client_label,
                s.last_seen_at,
                u.display_name,
                u.role
            FROM sessions s
            JOIN users u ON u.user_id = s.user_id
            WHERE s.last_seen_at >= ?
            ORDER BY s.last_seen_at DESC
            """,
            (cutoff,),
        ).fetchall()
    return [dict(row) for row in rows]


def log_activity(
    *,
    action: str,
    project_id: str = "",
    user_id: str = "",
    session_id: str = "",
    module_id: str = "",
    object_type: str = "",
    object_id: str = "",
    payload: dict[str, Any] | None = None,
) -> dict[str, Any]:
    project_id = _clean_text(project_id)
    if not project_id:
        raise ValueError("project_id je obavezan za activity log")
    ensure_project_db(project_id)
    now = _now()
    event_id = _id("evt")
    data = payload if isinstance(payload, dict) else {}
    with _connect_project(project_id) as conn:
        conn.execute(
            """
            INSERT INTO activity_log
                (event_id, project_id, user_id, session_id, module_id,
                 object_type, object_id, action, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                event_id,
                project_id,
                _clean_text(user_id),
                _clean_text(session_id),
                _clean_text(module_id),
                _clean_text(object_type),
                _clean_text(object_id),
                _clean_text(action, "unknown"),
                json.dumps(data, ensure_ascii=False),
                now,
            ),
        )
        conn.commit()
    return {
        "event_id": event_id,
        "project_id": project_id,
        "user_id": _clean_text(user_id),
        "session_id": _clean_text(session_id),
        "module_id": _clean_text(module_id),
        "object_type": _clean_text(object_type),
        "object_id": _clean_text(object_id),
        "action": _clean_text(action, "unknown"),
        "payload": data,
        "created_at": now,
    }


def get_activity_event(event_id: str) -> dict[str, Any]:
    return {}


def list_activity(project_id: str = "", limit: int = 100) -> list[dict[str, Any]]:
    limit = min(max(int(limit or 100), 1), 500)
    project_id = _clean_text(project_id)
    if not project_id:
        return []
    ensure_project_db(project_id)
    with _connect_project(project_id) as conn:
        rows = conn.execute(
            """
            SELECT * FROM activity_log
            WHERE project_id = ?
            ORDER BY created_at DESC, event_id DESC
            LIMIT ?
            """,
            (project_id, limit),
        ).fetchall()
    events: list[dict[str, Any]] = []
    for row in rows:
        item = dict(row)
        try:
            item["payload"] = json.loads(item.pop("payload_json") or "{}")
        except json.JSONDecodeError:
            item["payload"] = {}
        events.append(item)
    return events


def acquire_lock(
    *,
    project_id: str,
    object_type: str,
    object_id: str,
    user_id: str,
    session_id: str,
    lock_kind: str = "soft",
    note: str = "",
    ttl_seconds: int = 180,
) -> dict[str, Any]:
    ensure_project_db(project_id)
    now_ts = time.time()
    now = time.strftime("%Y-%m-%d %H:%M:%S", time.localtime(now_ts))
    expires = time.strftime(
        "%Y-%m-%d %H:%M:%S",
        time.localtime(now_ts + max(30, int(ttl_seconds or 180))),
    )
    key = (
        _clean_text(project_id),
        _clean_text(object_type),
        _clean_text(object_id),
    )
    if not all(key):
        raise ValueError("project_id, object_type i object_id su obavezni")
    with _connect_project(project_id) as conn:
        existing = conn.execute(
            """
            SELECT * FROM object_locks
            WHERE project_id = ? AND object_type = ? AND object_id = ?
            """,
            key,
        ).fetchone()
        if existing and existing["expires_at"] >= now and existing["session_id"] != session_id:
            lock = dict(existing)
            lock["conflict"] = True
            return lock
        conn.execute(
            """
            INSERT INTO object_locks
                (project_id, object_type, object_id, user_id, session_id,
                 lock_kind, note, acquired_at, expires_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(project_id, object_type, object_id) DO UPDATE SET
                user_id = excluded.user_id,
                session_id = excluded.session_id,
                lock_kind = excluded.lock_kind,
                note = excluded.note,
                expires_at = excluded.expires_at,
                updated_at = excluded.updated_at
            """,
            (
                *key,
                _clean_text(user_id),
                _clean_text(session_id),
                _clean_text(lock_kind, "soft"),
                _clean_text(note),
                now,
                expires,
                now,
            ),
        )
        conn.commit()
    lock = get_lock(project_id=key[0], object_type=key[1], object_id=key[2])
    lock["conflict"] = False
    return lock


def get_lock(project_id: str, object_type: str, object_id: str) -> dict[str, Any]:
    ensure_project_db(project_id)
    with _connect_project(project_id) as conn:
        row = conn.execute(
            """
            SELECT * FROM object_locks
            WHERE project_id = ? AND object_type = ? AND object_id = ?
            """,
            (_clean_text(project_id), _clean_text(object_type), _clean_text(object_id)),
        ).fetchone()
    return _row_dict(row)


def release_lock(project_id: str, object_type: str, object_id: str, session_id: str = "") -> bool:
    ensure_project_db(project_id)
    params: tuple[Any, ...]
    if session_id:
        sql = """
            DELETE FROM object_locks
            WHERE project_id = ? AND object_type = ? AND object_id = ? AND session_id = ?
        """
        params = (project_id, object_type, object_id, session_id)
    else:
        sql = """
            DELETE FROM object_locks
            WHERE project_id = ? AND object_type = ? AND object_id = ?
        """
        params = (project_id, object_type, object_id)
    with _connect_project(project_id) as conn:
        cur = conn.execute(sql, params)
        conn.commit()
    return cur.rowcount > 0


def list_locks(project_id: str = "", active_only: bool = True) -> list[dict[str, Any]]:
    project_id = _clean_text(project_id)
    if not project_id:
        return []
    ensure_project_db(project_id)
    now = _now()
    where: list[str] = []
    params: list[Any] = []
    if project_id:
        where.append("project_id = ?")
        params.append(project_id)
    if active_only:
        where.append("expires_at >= ?")
        params.append(now)
    sql = "SELECT * FROM object_locks"
    if where:
        sql += " WHERE " + " AND ".join(where)
    sql += " ORDER BY updated_at DESC"
    with _connect_project(project_id) as conn:
        rows = conn.execute(sql, params).fetchall()
    return [dict(row) for row in rows]
