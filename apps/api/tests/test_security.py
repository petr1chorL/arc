from app.security import SecurityService


def test_password_hash_is_argon2_and_verifies():
    security = SecurityService()
    encoded = security.hash_password("Correct Horse Battery Staple 42!")

    assert encoded != "Correct Horse Battery Staple 42!"
    assert encoded.startswith("$argon2id$")
    assert security.verify_password("Correct Horse Battery Staple 42!", encoded)
    assert not security.verify_password("wrong password", encoded)


def test_session_token_is_random_and_only_digest_is_stable():
    security = SecurityService()
    first = security.new_token()
    second = security.new_token()

    assert first != second
    assert len(first) >= 43
    assert security.digest_token(first) == security.digest_token(first)
    assert security.digest_token(first) != security.digest_token(second)
    assert security.token_matches(first, security.digest_token(first))
    assert not security.token_matches(second, security.digest_token(first))
