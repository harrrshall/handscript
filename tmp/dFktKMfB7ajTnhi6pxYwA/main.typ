#import "@preview/cmarker:0.1.8"
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
#set compact-enum(indent: 14pt, spacing: 14pt)

// Render markdown with LaTeX math support
// We expect 'content.md' to be present in the same directory
#let md_content = read("content.md")

#cmarker.render(
  md_content,
  math: mitex,
  smart-punctuation: true,
)
