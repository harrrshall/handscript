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

# New Template supporting semantic blocks
TYPST_TEMPLATE = """#import "@preview/showybox:2.0.1": showybox
#import "@preview/mitex:0.2.5": mitex

#set document(
  title: "Converted Notes",
  author: "HandScript"
)

#set page(
  paper: "a4",
  margin: (x: 2cm, y: 2.5cm),
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
#set par(justify: true)

// --- Semantic Blocks ---

#let container_box(title, color, body) = showybox(
  title: title,
  frame: (
    border-color: color.darken(20%),
    title-color: color.lighten(80%),
    body-color: color.lighten(95%),
    radius: 4pt
  ),
  body
)

#let definition(title: none, body) = container_box(
  if title != none [*Definition:* #title] else [*Definition*],
  blue,
  body
)

#let theorem(title: none, body) = container_box(
  if title != none [*Theorem* (#title)] else [*Theorem*],
  purple,
  body
)

#let proof(title: none, body) = block(
  width: 100%,
  inset: (left: 1em),
  stroke: (left: 2pt + gray),
  [_Proof._ #body #h(1fr) $square.stroked$]
)

#let example(title: none, body) = container_box(
  if title != none [*Example:* #title] else [*Example*],
  green,
  body
)

#let note(title: none, body) = container_box(
  if title != none [*Note:* #title] else [*Note*],
  yellow,
  body
)

#let warning(title: none, body) = container_box(
  if title != none [*Warning:* #title] else [*Warning*],
  red,
  body
)

#let tip(title: none, body) = note(title: title, body)
#let important(title: none, body) = warning(title: title, body)

// --- Layout ---
// Content appended dynamically
"""

@app.function(image=image, timeout=300)
@modal.web_endpoint(method="POST")
def render_pdf(item: dict):
    # Support 'typst' (new) or 'markdown' (legacy)
    typst_code = item.get("typst") or item.get("markdown")
    
    if not typst_code:
        return {"error": "Missing content (typst or markdown)"}, 400

    with tempfile.TemporaryDirectory() as tmpdir:
        # Write Combined Typst file
        main_path = os.path.join(tmpdir, "main.typ")
        with open(main_path, "w") as f:
            f.write(TYPST_TEMPLATE + "\n" + typst_code)

        # Compile
        output_path = os.path.join(tmpdir, "output.pdf")
        
        # Typst compile
        result = subprocess.run(
            ["typst", "compile", "main.typ", "output.pdf"],
            cwd=tmpdir,
            capture_output=True,
            env={**os.environ, "HOME": "/root"} 
        )

        if result.returncode != 0:
            return {"error": result.stderr.decode()}

        # Return PDF as base64
        with open(output_path, "rb") as f:
            import base64
            pdf_base64 = base64.b64encode(f.read()).decode()

        return {"pdf": pdf_base64}
