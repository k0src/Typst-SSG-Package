#import "../util/util.typ": *

#set-base("http://localhost:3000")

#let layout(body) = {
  set page(
    width: 42em,
    height: auto,
    margin: (x: 2em, top: 2.5em, bottom: 3em),
    fill: rgb("#ffffff"),
  )

  set text(
    font: ("Open Sans", "Arial"),
    size: 11pt,
    fill: rgb("#1a1a1a"),
  )

  set heading(numbering: none)

  show link: it => underline(text(fill: rgb("#2980b9"))[#it])

  show raw.where(block: true): it => block(
    width: 100%,
    inset: 1em,
    radius: 0.2em,
    fill: rgb("#f5f5f5"),
    stroke: 0.5pt + rgb("#ddd"),
    text(size: 0.9em, fill: rgb("#333"))[#it],
  )

  body
}