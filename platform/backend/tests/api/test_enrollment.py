import uuid
from datetime import UTC, datetime, timedelta

from httpx import AsyncClient

from app.domain.crypto import create_es256_key_pair, sign_jwt
from app.models import EnrollmentRequest
from sqlalchemy import UniqueConstraint, func, select


async def test_duplicate_enrollment_returns_original_request(
    client: AsyncClient,
    employee_headers: dict[str, str],
    db_factory,
) -> None:
    _, public_jwk = create_es256_key_pair()
    payload = {
        "installation_id": str(uuid.uuid4()),
        "public_key": public_jwk,
        "display_name": "Idempotent Workbench",
        "workbench_version": "1.0.0",
        "os": "linux",
        "arch": "x64",
    }

    first = await client.post("/api/v1/workbench-enrollments", headers=employee_headers, json=payload)
    second = await client.post("/api/v1/workbench-enrollments", headers=employee_headers, json=payload)

    assert first.status_code == 201
    assert second.status_code == 201
    assert second.json()["id"] == first.json()["id"]
    with db_factory() as session:
        assert session.scalar(select(func.count()).select_from(EnrollmentRequest)) == 1


def test_enrollment_identity_is_protected_by_database_unique_constraint() -> None:
    identity_columns = frozenset({"owner_principal_id", "installation_id", "public_key_thumbprint"})
    unique_column_sets = {
        frozenset(column.name for column in constraint.columns)
        for constraint in EnrollmentRequest.__table__.constraints
        if isinstance(constraint, UniqueConstraint)
    }

    assert identity_columns in unique_column_sets


async def test_real_key_enrollment_heartbeat_and_revocation(
    client: AsyncClient,
    system_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    private_jwk, public_jwk = create_es256_key_pair()
    installation_id = str(uuid.uuid4())
    created = await client.post(
        "/api/v1/workbench-enrollments",
        headers=employee_headers,
        json={
            "installation_id": installation_id,
            "public_key": public_jwk,
            "display_name": "Employee Workbench",
            "workbench_version": "1.0.0",
            "os": "linux",
            "arch": "x64",
        },
    )
    assert created.status_code == 201, created.text
    enrollment_id = created.json()["id"]

    assert (await client.post(
        f"/api/v1/workbench-enrollments/{enrollment_id}/approve", headers=employee_headers
    )).status_code == 403
    assert (await client.post(
        f"/api/v1/workbench-enrollments/{enrollment_id}/approve", headers=system_headers
    )).status_code == 200

    challenge_response = await client.post(
        f"/api/v1/workbench-enrollments/{enrollment_id}/challenge", headers=employee_headers
    )
    assert challenge_response.status_code == 201, challenge_response.text
    challenge = challenge_response.json()
    now = datetime.now(UTC)
    proof = sign_jwt(
        private_jwk,
        {
            "aud": f"http://localhost:18000/api/v1/workbench-enrollments/{enrollment_id}/complete",
            "enrollment_request_id": enrollment_id,
            "challenge_id": challenge["challenge_id"],
            "nonce": challenge["nonce"],
            "installation_id": installation_id,
            "iat": now,
            "exp": now + timedelta(minutes=1),
            "jti": str(uuid.uuid4()),
        },
    )
    completed = await client.post(
        f"/api/v1/workbench-enrollments/{enrollment_id}/complete",
        headers=employee_headers,
        json={"proof_jwt": proof},
    )
    assert completed.status_code == 200, completed.text
    workbench_id = completed.json()["workbench_instance_id"]

    assertion = sign_jwt(
        private_jwk,
        {
            "iss": workbench_id,
            "sub": workbench_id,
            "aud": "http://localhost:18000/oauth2/workbench/token",
            "iat": now,
            "exp": now + timedelta(minutes=1),
            "jti": str(uuid.uuid4()),
        },
    )
    token_response = await client.post(
        "/oauth2/workbench/token",
        data={
            "grant_type": "client_credentials",
            "client_id": workbench_id,
            "client_assertion_type": "urn:ietf:params:oauth:client-assertion-type:jwt-bearer",
            "client_assertion": assertion,
            "scope": "workbench.heartbeat",
        },
    )
    assert token_response.status_code == 200, token_response.text
    machine_token = token_response.json()["access_token"]
    machine_headers = {"Authorization": f"Bearer {machine_token}"}

    heartbeat = await client.post(
        f"/api/v1/workbenches/{workbench_id}/heartbeat",
        headers=machine_headers,
        json={"event_id": str(uuid.uuid4()), "reported_at": now.isoformat(), "workbench_version": "1.0.0"},
    )
    assert heartbeat.status_code == 200, heartbeat.text
    assert heartbeat.json()["connection_status"] == "ONLINE"

    own = await client.get("/api/v1/workbenches", headers=employee_headers)
    assert own.status_code == 200
    assert [item["id"] for item in own.json()["items"]] == [workbench_id]

    assert (await client.post(
        f"/api/v1/workbenches/{workbench_id}/revoke",
        headers=system_headers,
        json={"reason": "E2E revocation"},
    )).status_code == 200
    assert (await client.post(
        f"/api/v1/workbenches/{workbench_id}/heartbeat",
        headers=machine_headers,
        json={"event_id": str(uuid.uuid4()), "reported_at": now.isoformat(), "workbench_version": "1.0.0"},
    )).status_code == 401


async def test_completed_challenge_cannot_be_replayed(
    client: AsyncClient,
    system_headers: dict[str, str],
    employee_headers: dict[str, str],
) -> None:
    private_jwk, public_jwk = create_es256_key_pair()
    installation_id = str(uuid.uuid4())
    request = (await client.post(
        "/api/v1/workbench-enrollments",
        headers=employee_headers,
        json={
            "installation_id": installation_id,
            "public_key": public_jwk,
            "display_name": "Replay Test",
            "workbench_version": "1.0.0",
            "os": "linux",
            "arch": "x64",
        },
    )).json()
    await client.post(f"/api/v1/workbench-enrollments/{request['id']}/approve", headers=system_headers)
    challenge = (await client.post(
        f"/api/v1/workbench-enrollments/{request['id']}/challenge", headers=employee_headers
    )).json()
    now = datetime.now(UTC)
    proof = sign_jwt(
        private_jwk,
        {
            "aud": f"http://localhost:18000/api/v1/workbench-enrollments/{request['id']}/complete",
            "enrollment_request_id": request["id"],
            "challenge_id": challenge["challenge_id"],
            "nonce": challenge["nonce"],
            "installation_id": installation_id,
            "iat": now,
            "exp": now + timedelta(minutes=1),
            "jti": str(uuid.uuid4()),
        },
    )
    first = await client.post(
        f"/api/v1/workbench-enrollments/{request['id']}/complete",
        headers=employee_headers,
        json={"proof_jwt": proof},
    )
    replay = await client.post(
        f"/api/v1/workbench-enrollments/{request['id']}/complete",
        headers=employee_headers,
        json={"proof_jwt": proof},
    )

    assert first.status_code == 200
    assert replay.status_code == 409
    assert replay.json()["error"]["code"] == "CHALLENGE_ALREADY_USED"
