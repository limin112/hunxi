#!/usr/bin/env python3
"""Tripo3D pipeline smoke test: image -> 3D model -> rig (Tripo apiv3, Python stdlib only).

Key:    TRIPO_API_KEY env var, or a line  TRIPO_API_KEY=tsk_...  in <project>/.env
        (create it at platform.tripo3d.ai; API credits are billed there)
Region: openapi.tripo3d.ai by default; --cn or TRIPO_REGION=cn uses openapi.tripo3d.com

  python3 tools/tripo_test.py balance
  python3 tools/tripo_test.py run concept/boss_front.png --back concept/boss_back.png --name boss --rig
  python3 tools/tripo_test.py run concept/player_front.png --name player --rig
  python3 tools/tripo_test.py gen concept/player_front.png --name player       (model only)
  python3 tools/tripo_test.py rig <model_task_id> --name player --spec mixamo  (rig an existing model)
  python3 tools/tripo_test.py status <task_id>
  python3 tools/tripo_test.py inspect out/tripo/player_xxxx.glb

--dry-run prints every request instead of sending it. Results go to out/tripo/,
task ids are appended to out/tripo/runs.jsonl.
"""
import argparse
import json
import math
import mimetypes
import os
import struct
import sys
import time
import urllib.error
import urllib.request
import uuid

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
HOSTS = {"global": "https://openapi.tripo3d.ai", "cn": "https://openapi.tripo3d.com"}
DEFAULT_MODEL = "v3.1-20260211"      # generation model used in the current Tripo API docs
DEFAULT_RIG_MODEL = "v3.0-20260909"  # newest rig model listed by the official SDK (tripo3d 1.0.0)
TERMINAL = {"success", "failed", "cancelled", "banned", "expired"}
UA = "tripo-pipeline-test/0.1"


def _show(path):
    """Project-relative path for files inside the project, absolute otherwise."""
    p = os.path.abspath(path)
    return os.path.relpath(p, ROOT) if p.startswith(ROOT + os.sep) else p


class TripoError(Exception):
    pass


ENV_FILE = os.path.join(ROOT, ".env")


def setting(name):
    """Environment variable, else NAME=value from <project>/.env."""
    value = os.environ.get(name, "").strip()
    if value or not os.path.isfile(ENV_FILE):
        return value
    with open(ENV_FILE, encoding="utf-8") as f:
        for line in f:
            key, sep, val = line.strip().partition("=")
            if sep and not key.startswith("#") and key.strip() == name:
                return val.strip().strip("\"'")
    return ""


def load_key(dry_run):
    key = setting("TRIPO_API_KEY")
    if dry_run:
        return key or "tsk_dry_run"
    if not key:
        sys.exit("No TRIPO_API_KEY: put  TRIPO_API_KEY=tsk_...  in %s or export it." % ENV_FILE)
    if not key.startswith("tsk_"):
        sys.exit("TRIPO_API_KEY should start with tsk_ (create one at platform.tripo3d.ai).")
    return key


class Tripo:
    def __init__(self, key, host, dry_run=False):
        self.key, self.host, self.dry = key, host, dry_run

    def _headers(self, extra=None):
        headers = {"Authorization": "Bearer " + self.key, "Accept": "application/json",
                   "User-Agent": UA, "X-Tripo-Trace-ID": str(uuid.uuid4())}
        headers.update(extra or {})
        return headers

    def _send(self, method, path, body=None, headers=None):
        url = self.host + path
        # Only GETs are retried on network/5xx errors: a retried POST could create (and bill) a task twice.
        idempotent = method == "GET"
        for attempt in range(5):
            req = urllib.request.Request(url, data=body, method=method, headers=self._headers(headers))
            try:
                with urllib.request.urlopen(req, timeout=120) as resp:
                    status, text = resp.status, resp.read().decode("utf-8", "replace")
            except urllib.error.HTTPError as e:
                status, text = e.code, e.read().decode("utf-8", "replace")
            except OSError as e:  # URLError, timeouts, resets
                if idempotent and attempt < 4:
                    time.sleep(2 ** attempt)
                    continue
                raise TripoError("network error on %s %s: %s" % (method, path, e))
            if (status == 429 or (idempotent and status >= 500)) and attempt < 4:
                time.sleep(min(2 ** (attempt + 1), 30))
                continue
            return self._parse(status, text)

    @staticmethod
    def _parse(status, text):
        try:
            payload = json.loads(text) if text.strip() else {}
        except ValueError:
            raise TripoError("HTTP %d, non-JSON response: %s" % (status, text[:300]))
        if not isinstance(payload, dict):
            if status >= 400:
                raise TripoError("HTTP %d: %s" % (status, text[:300]))
            return payload
        code = payload.get("code")
        if status >= 400 or (code is not None and code != 0) or payload.get("status") == "error":
            hint = payload.get("suggestion")
            raise TripoError("HTTP %d, code %s: %s%s" % (status, code, payload.get("message") or "API error",
                                                        " (%s)" % hint if hint else ""))
        return payload.get("data", payload)

    def get(self, path):
        return self._send("GET", path)

    def post(self, path, payload):
        if self.dry:
            print("  [dry-run] POST %s %s" % (path, json.dumps(payload)))
            return {"task_id": "dry-" + uuid.uuid4().hex[:8]}
        return self._send("POST", path, json.dumps(payload).encode("utf-8"), {"Content-Type": "application/json"})

    def upload(self, path):
        if not os.path.isfile(path):
            raise TripoError("file not found: " + path)
        if self.dry:
            print("  [dry-run] upload %s" % path)
            return "file_dry_" + os.path.basename(path)
        if os.path.getsize(path) > 50 * 1024 * 1024:
            raise TripoError("%s is over 50 MB, shrink it first" % path)
        boundary = "----tripo" + uuid.uuid4().hex
        ctype = mimetypes.guess_type(path)[0] or "application/octet-stream"
        with open(path, "rb") as f:
            data = f.read()
        head = ('--%s\r\nContent-Disposition: form-data; name="file"; filename="%s"\r\nContent-Type: %s\r\n\r\n'
                % (boundary, os.path.basename(path), ctype)).encode("utf-8")
        body = head + data + ("\r\n--%s--\r\n" % boundary).encode("utf-8")
        res = self._send("POST", "/v3/files", body, {"Content-Type": "multipart/form-data; boundary=" + boundary})
        token = res.get("file_token") if isinstance(res, dict) else None
        if not token:
            raise TripoError("upload response has no file_token: %r" % (res,))
        print("  uploaded %s" % _show(path))
        return token

    def wait(self, task_id, label, timeout=1800):
        if self.dry:
            print("  [dry-run] wait %s (%s)" % (task_id, label))
            return {"task_id": task_id, "status": "success", "output": {}}
        t0, interval, last = time.time(), 3.0, None
        while True:
            task = self.get("/v3/tasks/" + task_id)
            status = str(task.get("status", "")).lower()
            line = "%s: %s %s%%" % (label, status, task.get("progress", 0))
            if line != last:
                print("  [%4ds] %s" % (time.time() - t0, line), flush=True)
                last = line
            if status in TERMINAL:
                if status != "success":
                    raise TripoError("%s %s (task %s): %s %s" % (
                        label, status, task_id, task.get("error_code") or "",
                        task.get("error_msg") or task.get("error_message") or ""))
                if task.get("credits_consumed") is not None:
                    print("  %s used %s credits" % (label, task["credits_consumed"]))
                return task
            if time.time() - t0 > timeout:
                raise TripoError("%s still %s after %ds; check later with: status %s" % (label, status, timeout, task_id))
            time.sleep(interval)
            interval = min(interval * 1.5, 15.0)


# ---------------------------------------------------------------- outputs

def _first_url(out, *keys):
    for k in keys:
        v = out.get(k)
        if isinstance(v, str) and v.startswith("http"):
            return v
        if isinstance(v, dict) and str(v.get("url", "")).startswith("http"):
            return v["url"]
    return None


def _ext(url, default):
    return os.path.splitext(url.split("?")[0].rsplit("/", 1)[-1])[1] or default


def download(url, dest):
    req = urllib.request.Request(url, headers={"User-Agent": UA})  # signed CDN URL: no API key sent
    with urllib.request.urlopen(req, timeout=600) as resp, open(dest, "wb") as f:
        while True:
            chunk = resp.read(1 << 16)
            if not chunk:
                break
            f.write(chunk)
    print("  saved %s (%.1f MB)" % (_show(dest), os.path.getsize(dest) / 1e6))
    return dest


def save_outputs(task, name, out_dir):
    out = task.get("output") or {}
    tid = str(task.get("task_id", "task"))[:8]
    files = {}
    model = _first_url(out, "model_url", "pbr_model_url", "model", "pbr_model")
    preview = _first_url(out, "rendered_image_url", "rendered_image")
    video = _first_url(out, "rendered_video_url")
    if model:
        files["model"] = download(model, os.path.join(out_dir, "%s_%s%s" % (name, tid, _ext(model, ".glb"))))
    if preview:
        files["preview"] = download(preview, os.path.join(out_dir, "%s_%s_preview%s" % (name, tid, _ext(preview, ".webp"))))
    if video:
        files["video"] = download(video, os.path.join(out_dir, "%s_%s_preview%s" % (name, tid, _ext(video, ".mp4"))))
    if not files and task.get("status") == "success" and out:
        print("  no downloadable file in output: %s" % json.dumps(out)[:400])
    return files


def log_run(out_dir, record):
    record["time"] = time.strftime("%Y-%m-%d %H:%M:%S")
    with open(os.path.join(out_dir, "runs.jsonl"), "a", encoding="utf-8") as f:
        f.write(json.dumps(record, ensure_ascii=False) + "\n")


# ---------------------------------------------------------------- GLB inspection

def _image_size(b):
    if b[:8] == b"\x89PNG\r\n\x1a\n" and len(b) >= 24:
        return struct.unpack(">II", b[16:24])
    if b[:2] == b"\xff\xd8":
        i = 2
        while i + 9 < len(b):
            if b[i] != 0xFF:
                i += 1
                continue
            marker = b[i + 1]
            if marker in (0xC0, 0xC1, 0xC2, 0xC3, 0xC5, 0xC6, 0xC7, 0xC9, 0xCA, 0xCB, 0xCD, 0xCE, 0xCF):
                h, w = struct.unpack(">HH", b[i + 5:i + 9])
                return w, h
            if marker == 0xFF:
                i += 1
                continue
            if marker in (0x01, 0xD8) or 0xD0 <= marker <= 0xD7:
                i += 2
                continue
            i += 2 + struct.unpack(">H", b[i + 2:i + 4])[0]
    if b[:4] == b"RIFF" and b[8:12] == b"WEBP" and len(b) >= 30:
        kind = b[12:16]
        if kind == b"VP8 ":
            w, h = struct.unpack("<HH", b[26:30])
            return w & 0x3FFF, h & 0x3FFF
        if kind == b"VP8L":
            bits = struct.unpack("<I", b[21:25])[0]
            return (bits & 0x3FFF) + 1, ((bits >> 14) & 0x3FFF) + 1
        if kind == b"VP8X":
            return 1 + int.from_bytes(b[24:27], "little"), 1 + int.from_bytes(b[27:30], "little")
    return None, None


def inspect_glb(path):
    with open(path, "rb") as f:
        data = f.read()
    name = _show(path)
    if data[:4] != b"glTF":
        print("  %s: not a GLB (%.1f MB), skipped" % (name, len(data) / 1e6))
        return None
    off, gltf, binary = 12, {}, b""
    while off + 8 <= len(data):
        length, kind = struct.unpack_from("<II", data, off)
        chunk = data[off + 8:off + 8 + length]
        if kind == 0x4E4F534A:    # JSON
            gltf = json.loads(chunk.decode("utf-8"))
        elif kind == 0x004E4942:  # BIN
            binary = chunk
        off += 8 + length

    acc, views = gltf.get("accessors", []), gltf.get("bufferViews", [])
    tris = verts = prims = 0
    lo, hi = [math.inf] * 3, [-math.inf] * 3
    for mesh in gltf.get("meshes", []):
        for p in mesh.get("primitives", []):
            prims += 1
            pos = acc[p["attributes"]["POSITION"]]
            verts += pos["count"]
            n = acc[p["indices"]]["count"] if "indices" in p else pos["count"]
            mode = p.get("mode", 4)
            tris += n // 3 if mode == 4 else max(n - 2, 0) if mode in (5, 6) else 0
            if "min" in pos and "max" in pos:
                lo = [min(a, b) for a, b in zip(lo, pos["min"])]
                hi = [max(a, b) for a, b in zip(hi, pos["max"])]

    textures = []
    for img in gltf.get("images", []):
        if "bufferView" in img:
            v = views[img["bufferView"]]
            start = v.get("byteOffset", 0)
            blob = binary[start:start + v["byteLength"]]
            w, h = _image_size(blob)
            textures.append("%s %s" % (img.get("mimeType", "?").split("/")[-1], "%dx%d" % (w, h) if w else "?"))
        else:
            textures.append("external")
    mats = gltf.get("materials", [])
    pbr = [m.get("pbrMetallicRoughness", {}) for m in mats]
    joints = sum(len(s.get("joints", [])) for s in gltf.get("skins", []))
    anims = [a.get("name") or "?" for a in gltf.get("animations", [])]
    size = [h - l for l, h in zip(lo, hi)] if lo[0] != math.inf else None

    print("  -- %s (%.1f MB)" % (name, len(data) / 1e6))
    print("     triangles %s, vertices %s, meshes %d, primitives %d" % (
        format(tris, ","), format(verts, ","), len(gltf.get("meshes", [])), prims))
    if size:
        print("     bbox (model units) x %.3f  y %.3f  z %.3f" % tuple(size))
    print("     materials %d: baseColor tex %s, metallicRoughness tex %s, normal tex %s" % (
        len(mats), any("baseColorTexture" in p for p in pbr),
        any("metallicRoughnessTexture" in p for p in pbr), any("normalTexture" in m for m in mats)))
    print("     textures: %s" % (", ".join(textures) or "none"))
    print("     skeleton: %s" % ("%d joints" % joints if joints else "none"))
    if anims:
        print("     animations: %s" % ", ".join(anims))
    if tris > 150000:
        print("     note: heavy for a skinned game character; try --face-limit 40000 or Tripo's smart low-poly")
    return {"triangles": tris, "joints": joints, "textures": textures}


# ---------------------------------------------------------------- commands

def cmd_gen(api, a):
    views = [a.front, a.left, a.back, a.right]
    tokens = [api.upload(v) if v else None for v in views]
    payload = {"model": a.model}
    if a.face_limit:
        payload["face_limit"] = a.face_limit
    if a.quad:
        payload["quad"] = True
    if a.hq:
        payload["texture_quality"] = "detailed"
    if any(tokens[1:]):
        payload["inputs"] = tokens          # [front, left, back, right], null for missing views
        path, kind = "/v3/generation/multiview-to-model", "multiview-to-model"
    else:
        payload["input"] = tokens[0]
        path, kind = "/v3/generation/image-to-model", "image-to-model"
    print("> %s (%s)" % (kind, a.model))
    task_id = api.post(path, payload)["task_id"]
    print("  task %s" % task_id)
    task = api.wait(task_id, kind)
    files = {} if api.dry else save_outputs(task, a.name, a.out)
    if not api.dry:
        log_run(a.out, {"name": a.name, "step": kind, "task_id": task_id, "model": a.model, "files": files})
    if files.get("model"):
        inspect_glb(files["model"])
    return task_id


def cmd_rig(api, a, model_task_id=None):
    source = model_task_id or a.task_id
    print("> rig-check")
    check = api.wait(api.post("/v3/animations/rig-check", {"input": source})["task_id"], "rig-check")
    out = check.get("output") or {}
    topology = out.get("rig_type") or out.get("topology")
    print("  riggable=%s topology=%s" % (out.get("riggable"), topology))
    if out.get("riggable") is False and not a.force:
        raise TripoError("Tripo says this model is not riggable. Use a cleaner A-pose image, or pass --force to try anyway.")
    payload = {"input": source, "model": a.rig_model, "rig_type": a.rig_type or topology or "biped",
               "spec": a.spec, "out_format": a.format}
    print("> rig (%s, spec=%s, %s)" % (a.rig_model, a.spec, a.format))
    task_id = api.post("/v3/animations/rig", payload)["task_id"]
    print("  task %s" % task_id)
    task = api.wait(task_id, "rig")
    files = {} if api.dry else save_outputs(task, a.name + "_rigged", a.out)
    if not api.dry:
        log_run(a.out, {"name": a.name, "step": "rig", "task_id": task_id, "source": source, "files": files})
    if files.get("model"):
        inspect_glb(files["model"])
    return task_id


def cmd_run(api, a):
    model_task = cmd_gen(api, a)
    if a.rig:
        cmd_rig(api, a, model_task)


def cmd_status(api, a):
    print(json.dumps(api.get("/v3/tasks/" + a.task_id), indent=2, ensure_ascii=False))


def cmd_balance(api, a):
    print(json.dumps(api.get("/v3/account/balance"), indent=2, ensure_ascii=False))


def main():
    common = argparse.ArgumentParser(add_help=False)
    common.add_argument("--cn", action="store_true", help="use openapi.tripo3d.com (China region)")
    common.add_argument("--dry-run", action="store_true", help="print requests instead of sending them")
    common.add_argument("--out", default=os.path.join(ROOT, "out", "tripo"), help="output directory")
    common.add_argument("--name", default="model", help="file name prefix for downloads")

    gen = argparse.ArgumentParser(add_help=False)
    gen.add_argument("front", help="front view image (required)")
    gen.add_argument("--back", help="back view image (switches to multiview)")
    gen.add_argument("--left", help="left view image (switches to multiview)")
    gen.add_argument("--right", help="right view image (switches to multiview)")
    gen.add_argument("--model", default=DEFAULT_MODEL, help="generation model version")
    gen.add_argument("--face-limit", type=int, help="target face count")
    gen.add_argument("--quad", action="store_true", help="quad topology")
    gen.add_argument("--hq", action="store_true", help="texture_quality=detailed")

    rig = argparse.ArgumentParser(add_help=False)
    rig.add_argument("--rig-model", default=DEFAULT_RIG_MODEL)
    rig.add_argument("--spec", default="mixamo", choices=["mixamo", "tripo", "unreal", "unity", "actorcore", "vrm"])
    rig.add_argument("--format", default="glb", choices=["glb", "fbx"])
    rig.add_argument("--rig-type", help="override the topology reported by rig-check (e.g. biped)")
    rig.add_argument("--force", action="store_true", help="rig even if rig-check says not riggable")

    p = argparse.ArgumentParser(description="Tripo3D pipeline smoke test")
    sub = p.add_subparsers(dest="cmd", required=True)
    sub.add_parser("balance", parents=[common]).set_defaults(fn=cmd_balance)
    sub.add_parser("gen", parents=[common, gen]).set_defaults(fn=cmd_gen)
    r = sub.add_parser("run", parents=[common, gen, rig])
    r.add_argument("--rig", action="store_true", help="also rig the generated model")
    r.set_defaults(fn=cmd_run)
    rg = sub.add_parser("rig", parents=[common, rig])
    rg.add_argument("task_id", help="task id of a finished generation task")
    rg.set_defaults(fn=cmd_rig)
    st = sub.add_parser("status", parents=[common])
    st.add_argument("task_id")
    st.set_defaults(fn=cmd_status)
    ins = sub.add_parser("inspect", parents=[common])
    ins.add_argument("files", nargs="+")
    ins.set_defaults(fn=None)
    a = p.parse_args()

    if a.cmd == "inspect":
        for f in a.files:
            inspect_glb(f)
        return
    os.makedirs(a.out, exist_ok=True)
    region = "cn" if a.cn or setting("TRIPO_REGION").lower() == "cn" else "global"
    api = Tripo(load_key(a.dry_run), HOSTS[region], dry_run=a.dry_run)
    try:
        a.fn(api, a)
    except TripoError as e:
        sys.exit("ERROR: %s" % e)
    except KeyboardInterrupt:
        sys.exit("\ninterrupted; a submitted task keeps running on Tripo's side (its id is printed above; use: status <task_id>)")


if __name__ == "__main__":
    main()
