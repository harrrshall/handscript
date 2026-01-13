import modal
import subprocess
import tempfile
import os

app = modal.App("handscript-typst")

image = modal.Image.debian_slim().run_commands([
    "apt-get update",
    "apt-get install -y wget",
    "wget -qO typst.tar.xz https://github.com/typst/typst/releases/download/v0.12.0/typst-x86_64-unknown-linux-musl.tar.xz",
    "tar -xf typst.tar.xz",
    "mv typst-x86_64-unknown-linux-musl/typst /usr/local/bin/",
    "chmod +x /usr/local/bin/typst"
]).pip_install("fastapi[standard]")

TYPST_TEMPLATE = """#import "@preview/cmarker:0.1.1"
#import "@preview/mitex:0.2.5": mitex

#set document(
  title: "Converted Notes",
  author: "HandScript"
)

#set page(
  paper: "a4",
  margin: (x: 2.5cm, y: 2.5cm),
  header: context {
    if counter(page).get().first() > 1 [
      #h(1fr) _HandScript Conversion_ #h(1fr)
    ]
  },
  numbering: "1"
)

#set text(
  font: "New Computer Modern",
  size: 11pt,
  lang: "en"
)

#set heading(numbering: "1.1")

// Add some nice spacing for lists
#set enum(indent: 14pt, spacing: 14pt)

// Render markdown with LaTeX math support
// We expect 'content.md' to be present in the same directory
#let md_content = read("content.md")

#cmarker.render(
  md_content,
  math: mitex,
  smart-punctuation: true,
)
"""

@app.function(image=image, timeout=300)
@modal.web_endpoint(method="POST")
def render_pdf(item: dict):
    # Modal web endpoints receive the body as arguments if using typed dictionary or just access standard Request
    # To simplify, we'll assume the body is parsed to the argument if it matches, but standard way is often just receiving Item or Request
    # But usually for JSON body:
    markdown = item.get("markdown")
    if not markdown:
        return {"error": "Missing markdown content"}, 400

    with tempfile.TemporaryDirectory() as tmpdir:
        # Write markdown content
        content_path = os.path.join(tmpdir, "content.md")
        with open(content_path, "w") as f:
            f.write(markdown)

        # Write Typst template
        main_path = os.path.join(tmpdir, "main.typ")
        with open(main_path, "w") as f:
            f.write(TYPST_TEMPLATE)

        # Compile
        output_path = os.path.join(tmpdir, "output.pdf")
        
        # We need to handle package downloads. Typst downloads to cache directory.
        # Since the container is ephemeral/fresh, it will download every time.
        # That is fine for now.
        result = subprocess.run(
            ["typst", "compile", "main.typ", "output.pdf"],
            cwd=tmpdir,
            capture_output=True,
            env={**os.environ, "HOME": "/root"} # ensure HOME is set for cache
        )

        if result.returncode != 0:
            return {"error": result.stderr.decode()}

        # Return PDF as base64
        with open(output_path, "rb") as f:
            import base64
            pdf_base64 = base64.b64encode(f.read()).decode()

        return {"pdf": pdf_base64}
