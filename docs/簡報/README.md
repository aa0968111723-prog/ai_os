# 簡報

對外／對內說明用的固定版面簡報。原始檔是 HTML（1920×1080，每個 `.slide` 一頁），
PDF 與 PPTX 都由它渲染而來——**要改內容請改 HTML，不要直接改 PDF/PPTX**。

| 檔案 | 用途 |
|---|---|
| `Aios系統介紹-剪輯組長.html` | 原始檔（自帶樣式，瀏覽器直接開即可預覽） |
| `Aios系統介紹-剪輯組長.pdf` | 給對方看的版本，16 頁，1440×810pt（16:9） |
| `Aios系統介紹-剪輯組長.pptx` | 需要現場翻頁／再加註解時用（每頁為整版圖） |

## 重新產生

字型用 Noto Sans TC ／ Noto Serif TC。系統若沒裝，中文會退回其他字型導致排版位移；
先安裝（Debian：`apt-get install fonts-noto-cjk`，或取 [notofonts/noto-cjk]
的 `Sans/SubsetOTF/TC` 與 `Serif/SubsetOTF/TC`）後再渲染。

```bash
python3 -m pip install playwright python-pptx
python3 - <<'PY'
from playwright.sync_api import sync_playwright
from pptx import Presentation
from pptx.util import Inches
import pathlib

SRC = pathlib.Path("docs/簡報/Aios系統介紹-剪輯組長.html").resolve()
OUT = SRC.parent
tmp = pathlib.Path("/tmp/aios-slides"); tmp.mkdir(exist_ok=True)

with sync_playwright() as p:
    b = p.chromium.launch()
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.goto(SRC.as_uri(), wait_until="load"); page.wait_for_timeout(2000)
    page.pdf(path=str(OUT / f"{SRC.stem}.pdf"), width="1920px", height="1080px",
             print_background=True, prefer_css_page_size=False,
             margin={"top": "0", "bottom": "0", "left": "0", "right": "0"})
    for i in range(page.locator(".slide").count()):
        page.locator(".slide").nth(i).screenshot(path=str(tmp / f"slide-{i+1:02d}.png"))
    b.close()

prs = Presentation(); prs.slide_width = Inches(13.333); prs.slide_height = Inches(7.5)
for img in sorted(tmp.glob("slide-*.png")):
    prs.slides.add_slide(prs.slide_layouts[6]).shapes.add_picture(
        str(img), 0, 0, width=prs.slide_width, height=prs.slide_height)
prs.save(OUT / f"{SRC.stem}.pptx")
PY
```

[notofonts/noto-cjk]: https://github.com/notofonts/noto-cjk
