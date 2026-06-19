"""MEDXONE SYNERGY backend regression tests."""
import os
import io
import pytest
import requests

BASE_URL = os.environ.get("REACT_APP_BACKEND_URL", "").rstrip("/")
if not BASE_URL:
    # Read from frontend/.env if not in env
    try:
        with open("/app/frontend/.env") as f:
            for line in f:
                if line.startswith("REACT_APP_BACKEND_URL="):
                    BASE_URL = line.split("=", 1)[1].strip().rstrip("/")
    except Exception:
        pass

API = f"{BASE_URL}/api"
ADMIN_EMAIL = "admin@medxone.com"
ADMIN_PASSWORD = "MedX0ne@2026"


@pytest.fixture(scope="session")
def admin_token():
    r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
    assert r.status_code == 200, r.text
    return r.json()["access_token"]


@pytest.fixture(scope="session")
def admin_headers(admin_token):
    return {"Authorization": f"Bearer {admin_token}"}


# ---------------- Categories ----------------
class TestCategories:
    def test_list_returns_seeded(self):
        r = requests.get(f"{API}/categories", timeout=15)
        assert r.status_code == 200
        cats = r.json()
        names = {c["name"] for c in cats}
        expected = {"Diagnostic Equipment", "Surgical Instruments", "Patient Monitoring",
                    "Laboratory Equipment", "Imaging Systems"}
        assert expected.issubset(names), f"Missing: {expected - names}"
        for c in cats:
            assert "id" in c and "name" in c and "created_at" in c


# ---------------- Products ----------------
class TestProducts:
    def test_list_returns_seeded_with_category_name(self):
        r = requests.get(f"{API}/products", timeout=15)
        assert r.status_code == 200
        products = r.json()
        assert len(products) >= 6
        for p in products:
            assert p.get("category_name"), f"Missing category_name for {p['name']}"

    def test_filter_by_category_id(self):
        cats = requests.get(f"{API}/categories", timeout=15).json()
        diag = next(c for c in cats if c["name"] == "Diagnostic Equipment")
        r = requests.get(f"{API}/products", params={"category_id": diag["id"]}, timeout=15)
        assert r.status_code == 200
        for p in r.json():
            assert p["category_id"] == diag["id"]

    def test_search_ecg(self):
        r = requests.get(f"{API}/products", params={"q": "ECG"}, timeout=15)
        assert r.status_code == 200
        names = [p["name"] for p in r.json()]
        assert any("ECG" in n for n in names), names

    def test_get_single_product(self):
        products = requests.get(f"{API}/products", timeout=15).json()
        pid = products[0]["id"]
        r = requests.get(f"{API}/products/{pid}", timeout=15)
        assert r.status_code == 200
        assert r.json()["id"] == pid
        assert r.json().get("category_name")

    def test_get_unknown_product_404(self):
        r = requests.get(f"{API}/products/nonexistent-id-xxx", timeout=15)
        assert r.status_code == 404


# ---------------- Auth ----------------
class TestAuth:
    def test_login_success(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": ADMIN_PASSWORD}, timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert "access_token" in data
        assert data["user"]["email"] == ADMIN_EMAIL

    def test_login_wrong_password(self):
        r = requests.post(f"{API}/auth/login", json={"email": ADMIN_EMAIL, "password": "wrongpass"}, timeout=15)
        assert r.status_code == 401

    def test_me_requires_token(self):
        r = requests.get(f"{API}/auth/me", timeout=15)
        assert r.status_code == 401

    def test_me_with_token(self, admin_headers):
        r = requests.get(f"{API}/auth/me", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["email"] == ADMIN_EMAIL


# ---------------- Category CRUD ----------------
class TestCategoryCRUD:
    def test_create_update_delete(self, admin_headers):
        # Create
        r = requests.post(f"{API}/categories", json={"name": "TEST_CatA", "description": "tmp"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        cid = r.json()["id"]
        # Update
        r = requests.put(f"{API}/categories/{cid}", json={"name": "TEST_CatA_Updated", "description": "tmp2"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_CatA_Updated"
        # Delete (empty)
        r = requests.delete(f"{API}/categories/{cid}", headers=admin_headers, timeout=15)
        assert r.status_code == 200

    def test_delete_category_with_products_fails(self, admin_headers):
        cats = requests.get(f"{API}/categories", timeout=15).json()
        diag = next(c for c in cats if c["name"] == "Diagnostic Equipment")
        r = requests.delete(f"{API}/categories/{diag['id']}", headers=admin_headers, timeout=15)
        assert r.status_code == 400


# ---------------- Product CRUD ----------------
class TestProductCRUD:
    def test_create_update_delete(self, admin_headers):
        cats = requests.get(f"{API}/categories", timeout=15).json()
        cid = cats[0]["id"]
        # Create
        payload = {"name": "TEST_Prod", "category_id": cid, "short_description": "x"}
        r = requests.post(f"{API}/products", json=payload, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        pid = r.json()["id"]
        assert r.json()["category_name"] == cats[0]["name"]
        # Verify persisted
        r2 = requests.get(f"{API}/products/{pid}", timeout=15)
        assert r2.status_code == 200
        # Update
        r = requests.put(f"{API}/products/{pid}", json={"name": "TEST_Prod_Updated"}, headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert r.json()["name"] == "TEST_Prod_Updated"
        # Delete
        r = requests.delete(f"{API}/products/{pid}", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        r2 = requests.get(f"{API}/products/{pid}", timeout=15)
        assert r2.status_code == 404


# ---------------- Upload ----------------
class TestUpload:
    def test_upload_requires_auth(self):
        files = {"file": ("test.png", b"\x89PNG\r\n\x1a\n", "image/png")}
        r = requests.post(f"{API}/upload", files=files, timeout=15)
        assert r.status_code == 401

    def test_upload_image_and_fetch(self, admin_headers):
        # 1x1 PNG
        png = bytes.fromhex("89504E470D0A1A0A0000000D49484452000000010000000108060000001F15C4890000000A49444154789C6300010000000500010D0A2DB40000000049454E44AE426082")
        files = {"file": ("test.png", png, "image/png")}
        r = requests.post(f"{API}/upload", files=files, headers=admin_headers, timeout=15)
        assert r.status_code == 200, r.text
        data = r.json()
        assert "url" in data and data["url"].startswith("/api/files/")
        assert "filename" in data and "size" in data
        # Fetch
        fr = requests.get(f"{BASE_URL}{data['url']}", timeout=15)
        assert fr.status_code == 200

    def test_upload_rejects_non_image(self, admin_headers):
        files = {"file": ("test.txt", b"hello", "text/plain")}
        r = requests.post(f"{API}/upload", files=files, headers=admin_headers, timeout=15)
        assert r.status_code == 400

    def test_upload_rejects_oversize(self, admin_headers):
        big = b"a" * (8 * 1024 * 1024 + 100)
        files = {"file": ("big.png", big, "image/png")}
        r = requests.post(f"{API}/upload", files=files, headers=admin_headers, timeout=30)
        assert r.status_code == 400


# ---------------- Inquiries ----------------
class TestInquiries:
    def test_public_create(self):
        payload = {"name": "TEST_User", "email": "test@example.com", "phone": "+1234567890",
                   "message": "Hello", "inquiry_type": "general"}
        r = requests.post(f"{API}/inquiries", json=payload, timeout=15)
        assert r.status_code == 200
        assert r.json()["ok"] is True

    def test_list_requires_auth(self):
        r = requests.get(f"{API}/inquiries", timeout=15)
        assert r.status_code == 401

    def test_list_with_auth(self, admin_headers):
        r = requests.get(f"{API}/inquiries", headers=admin_headers, timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)
