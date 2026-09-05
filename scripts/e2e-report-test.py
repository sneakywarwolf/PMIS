#!/usr/bin/env python3
"""End-to-end smoke test of the VAPT report engine against the live backend."""
import json, os, sys, urllib.request, urllib.error, http.cookiejar, uuid

BASE = "http://localhost:4000"
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))  # project root
OUT = os.path.join(ROOT, "scripts", "e2e-output")
os.makedirs(OUT, exist_ok=True)

def client():
    cj = http.cookiejar.CookieJar()
    return urllib.request.build_opener(urllib.request.HTTPCookieProcessor(cj))

def call(op, method, path, body=None, raw=False):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(BASE + path, data=data, method=method)
    if data: req.add_header("Content-Type", "application/json")
    try:
        r = op.open(req, timeout=30)
        payload = r.read()
        return r.status, (payload if raw else json.loads(payload or b"{}"))
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:500]

def multipart(op, path, fields, file_field, file_path, content_type):
    boundary = uuid.uuid4().hex
    parts = []
    for k, v in fields.items():
        parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n".encode())
    with open(file_path, "rb") as f:
        fdata = f.read()
    parts.append(f"--{boundary}\r\nContent-Disposition: form-data; name=\"{file_field}\"; filename=\"{os.path.basename(file_path)}\"\r\nContent-Type: {content_type}\r\n\r\n".encode())
    parts.append(fdata); parts.append(f"\r\n--{boundary}--\r\n".encode())
    body = b"".join(parts)
    req = urllib.request.Request(BASE + path, data=body, method="POST")
    req.add_header("Content-Type", f"multipart/form-data; boundary={boundary}")
    try:
        r = op.open(req, timeout=60)
        return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()[:800]

def step(msg): print(f"\n=== {msg} ===")

# ---------- 0. test PNG ----------
from PIL import Image, ImageDraw
img = Image.new("RGB", (1200, 700), "#1a1a2e")
d = ImageDraw.Draw(img)
d.rectangle([40, 40, 1160, 660], outline="#e94560", width=4)
d.text((80, 100), "POC EVIDENCE - Step 1: SQL injection in login form", fill="#ffffff")
d.text((80, 140), "Payload: admin' OR '1'='1' --  => authenticated as admin", fill="#ffd460")
png_path = os.path.join(OUT, "poc-step1.png"); img.save(png_path)
print("test image:", png_path)

# ---------- 1. admin login ----------
step("1. admin login")
admin = client()
s, r = call(admin, "POST", "/auth/login", {"username": "admin", "password": "Admin@1234567890!"})
assert s == 200, (s, r); print("ok:", r["user"]["username"])

# ---------- 2. people chain: AVP -> TL -> Tester ----------
step("2. setup people chain")
s, users = call(admin, "GET", "/users")
by_name = {u["username"]: u for u in users}
tl_id = by_name["teamlead"]["id"]; tester_id = by_name["tester1"]["id"]

avp = by_name.get("avp")
if not avp:
    s, avp = call(admin, "POST", "/users", {"username": "avp", "email": "avp@vapt.local",
        "password": "Avp@1234567890!", "role": "TEAM_LEAD"})
    assert s in (200, 201), (s, avp)
avp_id = avp["id"]; print("avp id:", avp_id)

for uid, prof in [(avp_id, {"fullName": "Rajesh Menon", "phone": "+91-9800000001",
                            "designation": "Assistant Vice President"}),
                  (tl_id, {"fullName": "Priya Sharma", "phone": "+91-9800000002",
                           "designation": "Team Lead", "managerId": avp_id}),
                  (tester_id, {"fullName": "Arjun Patel", "phone": "+91-9800000003",
                               "designation": "Security Analyst", "assignedTlId": tl_id})]:
    s, r = call(admin, "PUT", f"/users/{uid}", prof)
    assert s == 200, (uid, s, r)
print("profiles + manager chain set")

# ---------- 3. template upload (draft + validation) then activate ----------
step("3. upload PCI Web template")
tpl_file = os.path.join(ROOT, "Report Template", "PCI",
    "App-Security-Test_{Client-Name}-{Application-Name}_Web_v1.0_YYYY-MM-DD_Non-Compliant.docx")
s, tpl = multipart(admin, "/reports/templates",
    {"name": "PCI-Web-Template", "category": "PCI", "subType": "WEB", "effectiveFrom": "2026-08-30"},
    "file", tpl_file, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
assert s in (200, 201), (s, tpl)
tpl_id = tpl.get("id") or tpl.get("template", {}).get("id")
print("template id:", tpl_id, "| status:", tpl.get("status") or tpl.get("template", {}).get("status"))
val = tpl.get("validation") or {}
print("validation keys:", list(val.keys()) if isinstance(val, dict) else type(val))
print(json.dumps(val, indent=1)[:1200])

s, r = call(admin, "PUT", f"/reports/templates/{tpl_id}/activate")
print("activate:", s, str(r)[:200]); assert s == 200, (s, r)

# ---------- 4. tester login + create project ----------
step("4. tester1 login + create project")
tester = client()
s, r = call(tester, "POST", "/auth/login", {"username": "tester1", "password": "Tester@1234567890!"})
assert s == 200, (s, r)

proj_body = {
    "name": "Acme WebApp", "clientName": "Acme Corp",
    "scope": "https://webapp.acme.example.com/* (all authenticated and unauthenticated functionality)",
    "startDate": "2026-08-01", "endDate": "2026-08-15",
    "category": "PCI", "subType": "WEB",
    "appVersion": "4.2.1", "location": "Mumbai, India", "documentVersion": "1.0",
    "toolsUsed": "Burp Suite Professional, Nmap, OWASP ZAP, SQLMap",
    "testingEnvironment": "Staging (UAT)", "qaReviewerName": "Neha Kulkarni",
    "applicationDetails": "Customer-facing e-commerce web application with payment processing",
    "testingType": "Black Box", "loginSystemTypes": "Single role-based login (customer admin)",
    "applicationNature": "E-commerce web application handling cardholder data",
    "testingLimitation": "No source code access; production data masked; testing window 10PM-6AM IST",
}
s, proj = call(tester, "POST", "/projects", proj_body)
assert s in (200, 201), (s, proj)
pid = proj["id"]
print("project:", pid, "| templateId:", proj.get("templateId"))

# ---------- 5. finding from vuln DB + overrides ----------
step("5. create finding with CVSS override")
s, vulns = call(tester, "GET", "/vulnerabilities")
vl = vulns if isinstance(vulns, list) else vulns.get("items", vulns.get("data", []))
print("vuln library size:", len(vl))
vuln = next((v for v in vl if "SQL" in (v.get("title") or "")), vl[0])
print("using vuln:", vuln["id"], vuln.get("title"), "| db cvss:", vuln.get("cvssScore"))

s, finding = call(tester, "POST", "/findings", {
    "projectId": pid, "vulnId": vuln["id"],
    "testerNotes": "Login form username parameter is vulnerable to error-based SQL injection.",
    "affectedInstances": ["https://webapp.acme.example.com/login"],
    "reportStatus": "Open",
    "cvssScoreOverride": 9.1,
    "cvssVectorOverride": "CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:H/I:H/A:N",
})
assert s in (200, 201), (s, finding)
fid = finding["id"]; print("finding:", fid, "| status:", finding.get("status"))

# ---------- 6. POC image upload + steps ----------
step("6. POC image upload + steps")
s, up = multipart(tester, "/findings/upload-poc-image", {}, "file", png_path, "image/png")
assert s in (200, 201), (s, up)
img_path = up["path"]; print("uploaded image:", img_path)

s, st1 = call(tester, "POST", f"/findings/{fid}/poc-steps",
    {"stepNo": 1, "description": "Navigate to the login page and intercept the authentication request in Burp Suite.", "imagePath": img_path})
assert s in (200, 201), (s, st1)
s, st2 = call(tester, "POST", f"/findings/{fid}/poc-steps",
    {"stepNo": 2, "description": "Replace the username parameter with the payload admin' OR '1'='1' -- and forward the request."})
assert s in (200, 201), (s, st2)
print("2 poc steps added, step 1 has image")

# ---------- 7. TL approves finding ----------
step("7. teamlead approves finding")
tl = client()
s, r = call(tl, "POST", "/auth/login", {"username": "teamlead", "password": "Tl@1234567890!"})
assert s == 200, (s, r)
s, r = call(tl, "PUT", f"/findings/{fid}", {"status": "APPROVED"})
assert s == 200, (s, r)
print("finding status:", r.get("status"))

# ---------- 8. preflight ----------
step("8. preflight")
s, pre = call(tester, "GET", f"/reports/preflight/{pid}")
print(s, json.dumps(pre, indent=1)[:800])

# ---------- 9. generate ----------
step("9. generate report")
s, gen = call(tester, "POST", "/reports/generate", {"projectId": pid})
assert s in (200, 201), (s, gen)
print(json.dumps({k: (v[:100] + "..." if isinstance(v, str) and len(v) > 100 else v) for k, v in gen.items()}, indent=1))
url = gen.get("docxUrl")
assert url, gen

# ---------- 10. download ----------
step("10. download docx")
req = urllib.request.Request(url.replace("http://localhost:9000", "http://localhost:9000"))
data = urllib.request.urlopen(req, timeout=60).read()
out_docx = os.path.join(OUT, gen.get("fileName", "report.docx"))
with open(out_docx, "wb") as f: f.write(data)
print("saved:", out_docx, len(data), "bytes")

with open(os.path.join(OUT, "result.json"), "w") as f:
    json.dump({"projectId": pid, "findingId": fid, "fileName": gen.get("fileName"), "docx": out_docx}, f, indent=1)
print("\nE2E COMPLETE")
