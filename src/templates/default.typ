#let layout(body) = {
  set page(
    width: 42em,
    height: auto,
    margin: (x: 0.25em, y: 0.25em),
    fill: white
  )

  set text(
    font: "Libertinus Serif",
    size: 11pt,
    fill: black
  )

  set par(
    justify: true,
    leading: 0.65em
  )

  body
}