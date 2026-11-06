#!/usr/bin/env python3
import sys, io, json, warnings
warnings.filterwarnings('ignore')
from PIL import Image, ImageDraw, ImageFont
from brother_ql.conversion import convert
from brother_ql.backends.helpers import send
from brother_ql.raster import BrotherQLRaster

DEVICE = "file:///dev/usb/lp0"

# DK-11201 die-cut — brother_ql expects (W=306, H=991) portrait
LABEL_W = 306   # 29mm tape width @ 300 DPI
LABEL_H = 991   # 90mm label length @ 300 DPI

# Work in landscape, then rotate -90 before sending
WORK_W = LABEL_H   # 991 px = 90mm (long side)
WORK_H = LABEL_W   # 306 px = 29mm (tape height) — EVERYTHING must fit here

# Content fills only the LEFT half (~45mm); right half stays blank
HALF_W  = 495      # 45mm @ 300 DPI
PADDING = 6


def _font(size, bold=False):
    paths = (["/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Bold.ttf"] if bold else
             ["/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf",
              "/usr/share/fonts/truetype/liberation/LiberationSans-Regular.ttf"])
    for p in paths:
        try: return ImageFont.truetype(p, size)
        except OSError: pass
    return ImageFont.load_default()


def _make_barcode(text, width, height):
    """Generate Code128 barcode."""
    import barcode
    from barcode.writer import ImageWriter

    buf = io.BytesIO()
    barcode.get("code128", text, writer=ImageWriter()).write(buf, options={
        "module_width":  0.4,
        "module_height": 12.0,
        "quiet_zone":    1.0,
        "write_text":    False,
        "background":    "white",
        "foreground":    "black",
    })
    buf.seek(0)
    bc = Image.open(buf).convert("RGB")
    return bc.resize((width, height), Image.LANCZOS)


def build_image(data):
    pl      = data.get("pieceLabel",  "—")
    zone    = data.get("zone",        "")
    profile = data.get("profile",     "")
    length  = data.get("length",      "")
    desc    = data.get("desc",        "")
    bar     = data.get("barLabel",    "")
    pos     = data.get("cutPosition", "")

    f_id   = _font(54, True)   # piece label
    f_prof = _font(32, True)   # profile + length
    f_det  = _font(24)         # details
    f_zone = _font(22, True)   # zone badge
    f_sm   = _font(18)         # barcode text

    img  = Image.new("RGB", (WORK_W, WORK_H), (255, 255, 255))
    draw = ImageDraw.Draw(img)

    PAD = PADDING
    y   = PAD

    # Row 1: Piece label + zone badge
    draw.text((PAD, y), pl, font=f_id, fill=(0, 0, 0))
    if zone:
        ztw = int(draw.textlength(zone, font=f_zone))
        zx = HALF_W - PAD - ztw - 12
        zy = y + 8
        draw.rounded_rectangle([(zx-7, zy), (zx+ztw+7, zy+34)],
                               radius=4, fill=(0, 0, 0))
        draw.text((zx, zy+5), zone, font=f_zone, fill=(255, 255, 255))
    y += 62

    # Row 2: Profile + length — boxed
    pt  = f"{profile} · {length}mm" if profile else f"{length}mm"
    ptw = int(draw.textlength(pt, font=f_prof))
    box_x2 = min(PAD + ptw + 16, HALF_W - PAD)
    draw.rounded_rectangle([(PAD, y), (box_x2, y + 40)],
                           radius=5, outline=(0, 0, 0), width=2)
    draw.text((PAD + 8, y + 4), pt, font=f_prof, fill=(0, 0, 0))
    y += 46

    # Row 3: Description (optional)
    if desc:
        draw.text((PAD, y), desc, font=f_det, fill=(60, 60, 60))
        y += 28

    # Row 4: From / Position
    draw.text((PAD, y), f"From: {bar}  Pos: #{pos}",
              font=f_det, fill=(60, 60, 60))
    y += 32

    # Barcode (fixed shorter height)
    BC_H   = 60
    BC_W   = HALF_W - PAD * 2
    dim    = profile.split()[0] if profile else ""
    bc_text = f"{dim}-{length}" if dim else f"{length}"
    bc = _make_barcode(bc_text, BC_W, BC_H)
    img.paste(bc, (PAD, y))
    y += BC_H + 2

    # Barcode value text, centered under barcode
    tw = int(draw.textlength(bc_text, font=f_sm))
    draw.text((PAD + (BC_W - tw) // 2, y),
              bc_text, font=f_sm, fill=(0, 0, 0))

    # Rotate to brother_ql's portrait orientation
    final = img.rotate(-90, expand=True)
    assert final.size == (LABEL_W, LABEL_H), f"unexpected size: {final.size}"
    return final


def print_label(data):
    img = build_image(data)

    qlr = BrotherQLRaster("QL-800")
    qlr.exception_on_warning = False

    instructions = convert(
        qlr=qlr,
        images=[img],
        label="29x90",
        rotate="0",
        threshold=70.0,
        dither=False,
        compress=False,
        red=False,
        dpi_600=False,
        hq=True,
        cut=False,         # no auto-cut
    )

    send(
        instructions=instructions,
        printer_identifier=DEVICE,
        backend_identifier="linux_kernel",
        blocking=True,
    )
    print(f"OK — {len(instructions)} bytes")


if __name__ == "__main__":
    if len(sys.argv) < 2: sys.exit(1)
    try:
        print_label(json.loads(sys.argv[1]))
    except Exception as e:
        print(f"ERROR: {e}", file=sys.stderr); sys.exit(1)
