import modal
import os
import boto3
from botocore.config import Config
from fastapi import HTTPException
from pydantic import BaseModel

# Define the Modal image with required dependencies
image = (
    modal.Image.debian_slim()
    .apt_install(
        "wget", "gnupg", "ca-certificates",
        "libnss3", "libxss1", "libasound2", "libatk1.0-0",
        "libatk-bridge2.0-0", "libcups2", "libdrm2", "libgbm1",
        "libgtk-3-0", "libnspr4", "libxcomposite1", "libxdamage1",
        "libxfixes3", "libxrandr2", "xdg-utils", "fonts-liberation",
        "libappindicator3-1", "libu2f-udev", "libvulkan1"
    )
    .pip_install("playwright", "fastapi[standard]", "boto3")
    .run_commands(["playwright install chromium"])
)

app = modal.App("handscript-pdf")

class PDFRequest(BaseModel):
    html: str
    job_id: str = ""
    page_index: int = 0
    upload_to_b2: bool = False  # Flag to enable direct B2 upload

def get_s3_client():
    """Create S3 client for B2 using environment variables from Modal Secret."""
    endpoint = os.environ.get('B2_ENDPOINT', '')
    if not endpoint.startswith('http'):
        endpoint = f'https://{endpoint}'

    return boto3.client(
        's3',
        endpoint_url=endpoint,
        region_name=os.environ.get('B2_REGION', 'us-west-004'),
        aws_access_key_id=os.environ.get('B2_KEY_ID'),
        aws_secret_access_key=os.environ.get('B2_APPLICATION_KEY'),
        config=Config(signature_version='s3v4')
    )

@app.function(
    image=image,
    memory=1024,
    cpu=1.0,
    secrets=[modal.Secret.from_name("b2-credentials")]  # Inject B2 credentials
)
@modal.web_endpoint(method="POST")
async def render_pdf(request: PDFRequest):
    from playwright.async_api import async_playwright
    import base64

    try:
        async with async_playwright() as p:
            browser = await p.chromium.launch()
            page = await browser.new_page()

            # Set content with timeout
            await page.set_content(request.html, wait_until="networkidle", timeout=30000)

            # Generate PDF
            pdf_bytes = await page.pdf(
                format="A4",
                print_background=True,
                margin={
                    "top": "0",
                    "bottom": "0",
                    "left": "0",
                    "right": "0"
                }
            )

            await browser.close()

            # If B2 upload requested, upload and return key
            if request.upload_to_b2 and request.job_id:
                try:
                    s3_client = get_s3_client()
                    bucket_name = os.environ.get('B2_BUCKET_NAME', 'handscript-images')

                    # Generate unique key
                    pdf_key = f"pdfs/{request.job_id}/page_{request.page_index}.pdf"

                    # Upload to B2
                    s3_client.put_object(
                        Bucket=bucket_name,
                        Key=pdf_key,
                        Body=pdf_bytes,
                        ContentType='application/pdf'
                    )

                    return {
                        "success": True,
                        "key": pdf_key,
                        "size": len(pdf_bytes)
                    }

                except Exception as upload_error:
                    # Fall back to returning base64 if B2 upload fails
                    print(f"B2 upload failed, falling back to base64: {upload_error}")
                    return {
                        "pdf": base64.b64encode(pdf_bytes).decode("utf-8"),
                        "upload_failed": True,
                        "error": str(upload_error)
                    }

            # Default: return base64 encoded PDF
            return {"pdf": base64.b64encode(pdf_bytes).decode("utf-8")}

    except Exception as e:
        return {"error": str(e)}


# Health check endpoint
@app.function(image=image)
@modal.web_endpoint(method="GET")
async def health():
    return {"status": "healthy", "service": "handscript-pdf"}
