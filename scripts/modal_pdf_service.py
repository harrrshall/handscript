import modal
from fastapi import FastAPI, HTTPException
from pydantic import BaseModel

image = (
    modal.Image.debian_slim()
    .apt_install("wget", "gnupg", "ca-certificates")
    .run_commands([
        "apt-get update",
        "apt-get install -y libnss3 libxss1 libasound2 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libgtk-3-0 libnspr4 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 xdg-utils fonts-liberation libappindicator3-1 libu2f-udev libvulkan1",
    ])
    .pip_install("playwright", "fastapi[standard]")
    .run_commands(["playwright install chromium"])
)

app = modal.App("handscript-pdf")

web_app = FastAPI()

class PDFRequest(BaseModel):
    html: str

@app.function(image=image, memory=1024, cpu=1.0)
@modal.web_endpoint(method="POST")
async def render_pdf(request: PDFRequest):
    from playwright.async_api import async_playwright
    import base64

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()
            
            # Set content
            await page.set_content(request.html, wait_until="networkidle")
            
            # Generate PDF
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                margin={
                    "top": "0", # Margins handled by CSS
                    "bottom": "0",
                    "left": "0",
                    "right": "0"
                }
            )
            
            await browser.close()
            
            return {"pdf": base64.b64encode(pdf_bytes).decode("utf-8")}
    except Exception as e:
        return {"error": str(e)}
