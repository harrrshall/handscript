#import "@preview/showybox:2.0.1": showybox
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

// Content will be appended here by the compiler

