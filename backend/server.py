"""MEDXONE SYNERGY — Medical Device Distributor Catalog Backend.

Storage: Firebase Realtime Database (data + images-as-base64).
Auth:    Custom JWT (HS256) over the RTDB `users` collection.
"""
from dotenv import load_dotenv
from pathlib import Path

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / ".env")

import os
import uuid
import base64
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional, List

import bcrypt
import jwt
from fastapi import (
    FastAPI,
    APIRouter,
    HTTPException,
    Depends,
    UploadFile,
    File,
    Request,
)
from fastapi.responses import Response
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials
from starlette.middleware.cors import CORSMiddleware
from pydantic import BaseModel, EmailStr

import firebase_client

# ---------------------------------------------------------------------------
# Setup
# ---------------------------------------------------------------------------
ALLOWED_IMAGE_EXT = {"jpg", "jpeg", "png", "webp", "gif"}
MIME_BY_EXT = {
    "jpg": "image/jpeg",
    "jpeg": "image/jpeg",
    "png": "image/png",
    "webp": "image/webp",
    "gif": "image/gif",
}
MAX_IMAGE_BYTES = 1_500_000  # 1.5 MB — RTDB stores base64 (~33% larger)

JWT_ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_HOURS = 12

app = FastAPI(title="MEDXONE SYNERGY API")
api_router = APIRouter(prefix="/api")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
)
logger = logging.getLogger("medxone")

bearer_scheme = HTTPBearer(auto_error=False)


# ---------------------------------------------------------------------------
# Pydantic Models
# ---------------------------------------------------------------------------
class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class CategoryCreate(BaseModel):
    name: str
    description: Optional[str] = ""


class ProductCreate(BaseModel):
    name: str
    category_id: str
    short_description: str = ""
    description: str = ""
    specifications: str = ""
    image_url: Optional[str] = ""
    contact_email: str = ""
    contact_phone: str = ""


class ProductUpdate(BaseModel):
    name: Optional[str] = None
    category_id: Optional[str] = None
    short_description: Optional[str] = None
    description: Optional[str] = None
    specifications: Optional[str] = None
    image_url: Optional[str] = None
    contact_email: Optional[str] = None
    contact_phone: Optional[str] = None


class InquiryCreate(BaseModel):
    name: str
    email: EmailStr
    phone: Optional[str] = ""
    message: str
    product_id: Optional[str] = None
    product_name: Optional[str] = None
    inquiry_type: str = "general"


# ---------------------------------------------------------------------------
# Realtime Database helpers
# ---------------------------------------------------------------------------
def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def rtdb_get(col: str, doc_id: str) -> Optional[dict]:
    snap = firebase_client.ref(f"{col}/{doc_id}").get()
    if snap is None:
        return None
    if not isinstance(snap, dict):
        return None
    data = dict(snap)
    data["id"] = doc_id
    return data


def rtdb_list(col: str) -> List[dict]:
    snap = firebase_client.ref(col).get() or {}
    items: List[dict] = []
    if isinstance(snap, dict):
        for doc_id, data in snap.items():
            if isinstance(data, dict):
                d = dict(data)
                d["id"] = doc_id
                items.append(d)
    return items


def rtdb_set(col: str, doc_id: str, data: dict) -> None:
    firebase_client.ref(f"{col}/{doc_id}").set(data)


def rtdb_update(col: str, doc_id: str, data: dict) -> None:
    firebase_client.ref(f"{col}/{doc_id}").update(data)


def rtdb_delete(col: str, doc_id: str) -> None:
    firebase_client.ref(f"{col}/{doc_id}").delete()


# ---------------------------------------------------------------------------
# Auth helpers
# ---------------------------------------------------------------------------
def hash_password(password: str) -> str:
    return bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode("utf-8"), hashed.encode("utf-8"))


def create_access_token(user_id: str, email: str) -> str:
    payload = {
        "sub": user_id,
        "email": email,
        "exp": datetime.now(timezone.utc) + timedelta(hours=ACCESS_TOKEN_EXPIRE_HOURS),
        "type": "access",
    }
    return jwt.encode(payload, os.environ["JWT_SECRET"], algorithm=JWT_ALGORITHM)


def find_user_by_email(email: str) -> Optional[dict]:
    for u in rtdb_list("users"):
        if u.get("email") == email:
            return u
    return None


async def get_current_admin(
    request: Request,
    credentials: Optional[HTTPAuthorizationCredentials] = Depends(bearer_scheme),
) -> dict:
    token = None
    if credentials and credentials.scheme.lower() == "bearer":
        token = credentials.credentials
    if not token:
        token = request.cookies.get("access_token")
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    try:
        payload = jwt.decode(token, os.environ["JWT_SECRET"], algorithms=[JWT_ALGORITHM])
        if payload.get("type") != "access":
            raise HTTPException(status_code=401, detail="Invalid token type")
        user = rtdb_get("users", payload["sub"])
        if not user:
            raise HTTPException(status_code=401, detail="User not found")
        return {"id": user["id"], "email": user["email"], "role": user.get("role", "admin")}
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")


# ---------------------------------------------------------------------------
# Auth endpoints
# ---------------------------------------------------------------------------
@api_router.post("/auth/login")
async def login(payload: LoginRequest):
    email = payload.email.lower().strip()
    user = find_user_by_email(email)
    if not user or not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    token = create_access_token(user["id"], user["email"])
    return {
        "access_token": token,
        "token_type": "bearer",
        "user": {"id": user["id"], "email": user["email"], "role": user.get("role", "admin")},
    }


@api_router.get("/auth/me")
async def me(admin=Depends(get_current_admin)):
    return admin


# ---------------------------------------------------------------------------
# Categories
# ---------------------------------------------------------------------------
def _category_out(doc: dict) -> dict:
    return {
        "id": doc["id"],
        "name": doc.get("name", ""),
        "description": doc.get("description", ""),
        "created_at": doc.get("created_at", ""),
    }


@api_router.get("/categories")
async def list_categories():
    cats = rtdb_list("categories")
    cats.sort(key=lambda c: c.get("name", ""))
    return [_category_out(c) for c in cats]


@api_router.post("/categories")
async def create_category(payload: CategoryCreate, admin=Depends(get_current_admin)):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    if any(c.get("name", "").lower() == name.lower() for c in rtdb_list("categories")):
        raise HTTPException(status_code=400, detail="Category already exists")
    new_id = str(uuid.uuid4())
    doc = {
        "name": name,
        "description": payload.description or "",
        "created_at": now_iso(),
    }
    rtdb_set("categories", new_id, doc)
    doc["id"] = new_id
    return _category_out(doc)


@api_router.put("/categories/{category_id}")
async def update_category(
    category_id: str, payload: CategoryCreate, admin=Depends(get_current_admin)
):
    name = payload.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Category name is required")
    if not rtdb_get("categories", category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    rtdb_update("categories", category_id, {"name": name, "description": payload.description or ""})
    return _category_out(rtdb_get("categories", category_id))


@api_router.delete("/categories/{category_id}")
async def delete_category(category_id: str, admin=Depends(get_current_admin)):
    products_using = [p for p in rtdb_list("products") if p.get("category_id") == category_id]
    if products_using:
        raise HTTPException(
            status_code=400,
            detail=f"Cannot delete category — {len(products_using)} product(s) still use it.",
        )
    if not rtdb_get("categories", category_id):
        raise HTTPException(status_code=404, detail="Category not found")
    rtdb_delete("categories", category_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Products
# ---------------------------------------------------------------------------
def _product_out(doc: dict, cat_map: Optional[dict] = None) -> dict:
    cat_map = cat_map or {}
    return {
        "id": doc["id"],
        "name": doc.get("name", ""),
        "category_id": doc.get("category_id", ""),
        "category_name": cat_map.get(doc.get("category_id"), None),
        "short_description": doc.get("short_description", ""),
        "description": doc.get("description", ""),
        "specifications": doc.get("specifications", ""),
        "image_url": doc.get("image_url", ""),
        "contact_email": doc.get("contact_email", ""),
        "contact_phone": doc.get("contact_phone", ""),
        "created_at": doc.get("created_at", ""),
    }


def _cat_map() -> dict:
    return {c["id"]: c.get("name") for c in rtdb_list("categories")}


@api_router.get("/products")
async def list_products(category_id: Optional[str] = None, q: Optional[str] = None):
    products = rtdb_list("products")
    if category_id:
        products = [p for p in products if p.get("category_id") == category_id]
    if q:
        ql = q.lower()
        products = [
            p for p in products
            if ql in (p.get("name", "") + " " + p.get("short_description", "") + " " + p.get("description", "")).lower()
        ]
    products.sort(key=lambda p: p.get("created_at", ""), reverse=True)
    cat_map = _cat_map()
    return [_product_out(p, cat_map) for p in products]


@api_router.get("/products/{product_id}")
async def get_product(product_id: str):
    p = rtdb_get("products", product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    return _product_out(p, _cat_map())


@api_router.post("/products")
async def create_product(payload: ProductCreate, admin=Depends(get_current_admin)):
    if not rtdb_get("categories", payload.category_id):
        raise HTTPException(status_code=400, detail="Invalid category")
    new_id = str(uuid.uuid4())
    doc = {
        "name": payload.name.strip(),
        "category_id": payload.category_id,
        "short_description": payload.short_description or "",
        "description": payload.description or "",
        "specifications": payload.specifications or "",
        "image_url": payload.image_url or "",
        "contact_email": payload.contact_email or "",
        "contact_phone": payload.contact_phone or "",
        "created_at": now_iso(),
    }
    rtdb_set("products", new_id, doc)
    doc["id"] = new_id
    return _product_out(doc, _cat_map())


@api_router.put("/products/{product_id}")
async def update_product(
    product_id: str, payload: ProductUpdate, admin=Depends(get_current_admin)
):
    if not rtdb_get("products", product_id):
        raise HTTPException(status_code=404, detail="Product not found")
    update_doc = {k: v for k, v in payload.model_dump(exclude_none=True).items()}
    if "category_id" in update_doc and not rtdb_get("categories", update_doc["category_id"]):
        raise HTTPException(status_code=400, detail="Invalid category")
    if update_doc:
        rtdb_update("products", product_id, update_doc)
    return _product_out(rtdb_get("products", product_id), _cat_map())


@api_router.delete("/products/{product_id}")
async def delete_product(product_id: str, admin=Depends(get_current_admin)):
    p = rtdb_get("products", product_id)
    if not p:
        raise HTTPException(status_code=404, detail="Product not found")
    # If the image lives in RTDB (/api/files/<id>), delete it too.
    img = p.get("image_url", "") or ""
    if img.startswith("/api/files/"):
        image_id = img.rsplit("/", 1)[-1]
        try:
            rtdb_delete("images", image_id)
        except Exception as exc:
            logger.warning("Failed to delete image %s: %s", image_id, exc)
    rtdb_delete("products", product_id)
    return {"ok": True}


# ---------------------------------------------------------------------------
# Upload — stores image as base64 inside RTDB
# ---------------------------------------------------------------------------
@api_router.post("/upload")
async def upload_file(file: UploadFile = File(...), admin=Depends(get_current_admin)):
    if not file.filename:
        raise HTTPException(status_code=400, detail="File required")
    ext = file.filename.rsplit(".", 1)[-1].lower() if "." in file.filename else ""
    if ext not in ALLOWED_IMAGE_EXT:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type. Allowed: {', '.join(sorted(ALLOWED_IMAGE_EXT))}",
        )
    content = await file.read()
    if len(content) > MAX_IMAGE_BYTES:
        raise HTTPException(
            status_code=400,
            detail=f"Image too large (max {MAX_IMAGE_BYTES // 1024} KB). Please compress and try again.",
        )

    image_id = uuid.uuid4().hex
    content_type = MIME_BY_EXT.get(ext, file.content_type or "application/octet-stream")
    encoded = base64.b64encode(content).decode("ascii")

    rtdb_set("images", image_id, {
        "data": encoded,
        "content_type": content_type,
        "size": len(content),
        "created_at": now_iso(),
    })

    return {"url": f"/api/files/{image_id}", "filename": image_id, "size": len(content)}


@api_router.get("/files/{image_id}")
async def serve_file(image_id: str):
    if "/" in image_id or ".." in image_id:
        raise HTTPException(status_code=400, detail="Invalid image id")
    rec = rtdb_get("images", image_id)
    if not rec:
        raise HTTPException(status_code=404, detail="Image not found")
    try:
        raw = base64.b64decode(rec["data"])
    except Exception:
        raise HTTPException(status_code=500, detail="Corrupt image data")
    return Response(
        content=raw,
        media_type=rec.get("content_type", "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# ---------------------------------------------------------------------------
# Inquiries
# ---------------------------------------------------------------------------
@api_router.post("/inquiries")
async def create_inquiry(payload: InquiryCreate):
    new_id = str(uuid.uuid4())
    doc = payload.model_dump()
    doc["created_at"] = now_iso()
    doc["status"] = "new"
    rtdb_set("inquiries", new_id, doc)
    logger.info("New inquiry from %s (%s)", payload.name, payload.email)
    return {"ok": True, "id": new_id}


@api_router.get("/inquiries")
async def list_inquiries(admin=Depends(get_current_admin)):
    items = rtdb_list("inquiries")
    items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
    return items


@api_router.get("/")
async def root():
    return {
        "service": "MEDXONE SYNERGY API",
        "status": "ok",
        "firebase_ready": firebase_client.is_ready(),
    }


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------
SEED_CATEGORIES = [
    {"name": "Diagnostic Equipment", "description": "Tools for clinical diagnosis and screening."},
    {"name": "Surgical Instruments", "description": "Precision instruments for surgical procedures."},
    {"name": "Patient Monitoring", "description": "Devices for continuous patient vital monitoring."},
    {"name": "Laboratory Equipment", "description": "Equipment for medical and research laboratories."},
    {"name": "Imaging Systems", "description": "Advanced medical imaging hardware."},
]

SEED_PRODUCTS = [
    {
        "name": "12-Lead ECG Diagnostic System",
        "category": "Diagnostic Equipment",
        "short_description": "High-resolution ECG with AI-assisted rhythm analysis.",
        "description": "Compact, hospital-grade 12-lead ECG offering real-time arrhythmia detection, "
        "HL7 connectivity, and a 10.4\" touchscreen interface — ideal for cardiology departments.",
        "specifications": "Channels: 12-lead | Sampling: 32,000 Hz | Display: 10.4\" colour TFT | "
        "Storage: 2,000 records | Connectivity: Wi-Fi, LAN, USB | Weight: 2.6 kg",
        "image_url": "https://images.unsplash.com/photo-1516549655169-df83a0774514?w=900&auto=format&fit=crop",
        "contact_email": "sales@medxone.com",
        "contact_phone": "+91 98765 43210",
    },
    {
        "name": "Multi-Parameter Patient Monitor",
        "category": "Patient Monitoring",
        "short_description": "ICU-grade monitor covering ECG, SpO2, NIBP, Temp & Respiration.",
        "description": "Designed for ICU and emergency departments, this multi-parameter monitor "
        "delivers continuous, accurate readings of all critical vital signs with configurable alerts.",
        "specifications": "Parameters: 5-in-1 (ECG, SpO2, NIBP, Temp, Resp) | Display: 12.1\" TFT | "
        "Battery: 6 hrs | Networking: HL7, Ethernet | Mounting: Pole / Wall / Bedside",
        "image_url": "https://images.pexels.com/photos/3845129/pexels-photo-3845129.jpeg?w=900",
        "contact_email": "sales@medxone.com",
        "contact_phone": "+91 98765 43211",
    },
    {
        "name": "Portable Ultrasound Imaging System",
        "category": "Imaging Systems",
        "short_description": "Cart-free colour Doppler ultrasound with wireless probes.",
        "description": "A portable, battery-powered colour Doppler ultrasound system with three "
        "interchangeable wireless probes — perfect for point-of-care, OB-GYN, and emergency use.",
        "specifications": "Display: 15.6\" full HD | Probes: Convex, Linear, Cardiac (wireless) | "
        "Modes: B, M, Colour, PW, CW | Battery: 4 hrs | Weight: 5.2 kg",
        "image_url": "https://images.pexels.com/photos/13697729/pexels-photo-13697729.jpeg?w=900",
        "contact_email": "imaging@medxone.com",
        "contact_phone": "+91 98765 43212",
    },
    {
        "name": "Stainless-Steel Surgical Instrument Kit",
        "category": "Surgical Instruments",
        "short_description": "42-piece premium-grade surgical instrument set.",
        "description": "Comprehensive 42-piece surgical kit forged from German stainless steel — "
        "autoclavable, ergonomically balanced, and supplied in a sterilisable tray.",
        "specifications": "Pieces: 42 | Material: AISI 420 stainless steel | Sterilisation: Autoclave-safe "
        "(up to 200°C) | Tray: Perforated stainless steel | Warranty: 5 years",
        "image_url": "https://images.unsplash.com/photo-1551601651-2a8555f1a136?w=900&auto=format&fit=crop",
        "contact_email": "surgical@medxone.com",
        "contact_phone": "+91 98765 43213",
    },
    {
        "name": "Automated Hematology Analyser",
        "category": "Laboratory Equipment",
        "short_description": "5-part differential CBC analyser, 60 samples/hour.",
        "description": "Fully automated 5-part differential haematology analyser with 26 reportable "
        "parameters, ideal for mid-volume clinical and pathology labs.",
        "specifications": "Throughput: 60 samples/hr | Parameters: 26 | Sample volume: 20 µL | "
        "Reagents: Closed-system | Connectivity: LIS, USB, LAN",
        "image_url": "https://images.unsplash.com/photo-1581093588401-fbb62a02f120?w=900&auto=format&fit=crop",
        "contact_email": "lab@medxone.com",
        "contact_phone": "+91 98765 43214",
    },
    {
        "name": "Digital Otoscope with HD Camera",
        "category": "Diagnostic Equipment",
        "short_description": "Wi-Fi enabled HD otoscope with image capture & review.",
        "description": "A digital otoscope with built-in HD camera and Wi-Fi, allowing real-time "
        "image / video capture and remote ENT consultation.",
        "specifications": "Resolution: 1080p HD | LED: Cool-white | Connectivity: Wi-Fi, USB-C | "
        "Battery: 4 hrs | App: iOS, Android, Windows",
        "image_url": "https://images.unsplash.com/photo-1559757175-5700dde675bc?w=900&auto=format&fit=crop",
        "contact_email": "sales@medxone.com",
        "contact_phone": "+91 98765 43215",
    },
]


def seed_admin():
    email = os.environ["ADMIN_EMAIL"].lower().strip()
    password = os.environ["ADMIN_PASSWORD"]
    existing = find_user_by_email(email)
    if existing is None:
        new_id = str(uuid.uuid4())
        rtdb_set("users", new_id, {
            "email": email,
            "password_hash": hash_password(password),
            "role": "admin",
            "created_at": now_iso(),
        })
        logger.info("Seeded admin user: %s", email)
    elif not verify_password(password, existing["password_hash"]):
        rtdb_update("users", existing["id"], {"password_hash": hash_password(password)})
        logger.info("Updated admin password for: %s", email)


def seed_catalog():
    if rtdb_get("meta", "seeded"):
        return
    name_to_id = {}
    for cat in SEED_CATEGORIES:
        new_id = str(uuid.uuid4())
        rtdb_set("categories", new_id, {
            "name": cat["name"],
            "description": cat["description"],
            "created_at": now_iso(),
        })
        name_to_id[cat["name"]] = new_id
    for prod in SEED_PRODUCTS:
        cat_id = name_to_id.get(prod["category"])
        if not cat_id:
            continue
        new_id = str(uuid.uuid4())
        rtdb_set("products", new_id, {
            "name": prod["name"],
            "category_id": cat_id,
            "short_description": prod["short_description"],
            "description": prod["description"],
            "specifications": prod["specifications"],
            "image_url": prod["image_url"],
            "contact_email": prod["contact_email"],
            "contact_phone": prod["contact_phone"],
            "created_at": now_iso(),
        })
    rtdb_set("meta", "seeded", {"at": now_iso()})
    logger.info("Seeded categories + products into Realtime Database.")


@app.on_event("startup")
async def on_startup():
    firebase_client.init_at_startup()
    if firebase_client.is_ready():
        try:
            seed_admin()
            seed_catalog()
        except Exception as exc:
            logger.error("Seeding failed: %s", exc)
    else:
        logger.warning(
            "Firebase is not configured yet — API endpoints will return 503 until "
            "you place firebase-credentials.json and set FIREBASE_DATABASE_URL. "
            "See /app/FIREBASE_SETUP.md for instructions."
        )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get("CORS_ORIGINS", "*").split(","),
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# Serve the static HTML/CSS/JS frontend directly from FastAPI.
# This lets the project run with zero Node.js / yarn dependency locally — a
# single `uvicorn server:app` starts the entire site at http://localhost:8001
# (the same backend that already handles /api/*).
#
# The mount MUST be added AFTER `include_router` so that /api/* routes win
# over the static catch-all on "/".
# ---------------------------------------------------------------------------
from fastapi.staticfiles import StaticFiles  # noqa: E402

_default_frontend_dir = ROOT_DIR.parent / "frontend" / "public"
FRONTEND_DIR = Path(os.environ.get("FRONTEND_PUBLIC_DIR", str(_default_frontend_dir)))
if FRONTEND_DIR.is_dir():
    app.mount("/", StaticFiles(directory=str(FRONTEND_DIR), html=True), name="frontend")
    logger.info("Serving static frontend from %s", FRONTEND_DIR)
else:
    logger.info(
        "Frontend dir not found at %s — running API-only mode. "
        "Set FRONTEND_PUBLIC_DIR if you keep the frontend elsewhere.",
        FRONTEND_DIR,
    )


# ---------------------------------------------------------------------------
# Allow running directly: `python server.py`
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn

    host = os.environ.get("HOST", "0.0.0.0")
    port = int(os.environ.get("PORT", "8001"))
    reload_flag = os.environ.get("RELOAD", "1") not in ("0", "false", "False", "")

    print()
    print("=" * 60)
    print("  MEDXONE SYNERGY — starting at http://localhost:%d" % port)
    print("  Admin login:  http://localhost:%d/admin.html" % port)
    print("  Press Ctrl+C to stop.")
    print("=" * 60)
    print()

    uvicorn.run(
        "server:app",
        host=host,
        port=port,
        reload=reload_flag,
        log_level="info",
    )
