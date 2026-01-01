#import "@preview/cetz:0.4.2": canvas, draw
#import "@preview/cetz-plot:0.1.3": plot

= About

This is the about page.

You can create new pages by adding `.typ` files to the `pages/` directory.

== About Typst SSG

=== Routing

- `pages/index.typ` #sym.arrow `/`
- `pages/about.typ` #sym.arrow `/about/`
- `pages/blog/post.typ` #sym.arrow `/blog/post/`

=== Layout System

Create `index.typ` files in any directory to define layouts:

```typst
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

  body
}
```

Then all pages in that directory will use this layout automatically.

=== Images

You can add images to your site by adding images to the `assets/` folder (or any other folder in `src/`), and importing them with the `image` function:

```typst
#image("../assets/img.jpg")
```

=== CSS Styling

Most styling is done within the Typst document itself. However, to change the overall appearance of your site, you can create a CSS file in the root of a directory.

For example, to change the background color of the site, create a `index.css` file in the `pages/` folder, and target the `pdf-container` element:

```css
#pdf-container {
  background: #ff0000; /* Change the background color to red */
}
```

_Note: this is the element that contains the compiled Typst document. To fully change the background color to #text(fill: rgb("#ff0000"), "red"), you must also set the `page` `fill` to the same color._

== About Typst

Typst is a markup language similar to LaTeX used for typesetting documents. Since the compilation process is fairly simple and very fast, we can use it to create beautiful static websites.

The best place to start learning Typst is the #link("https://typst.app/docs/tutorial/")[official tutorial].


=== Basic Syntax

- To start writing Typst documents, simply create a `.typ` file and add your content.
- To add *headings*, use `=` for top-level headings, `==` for second-level headings, etc.
- *Bulleted lists* can be created using `-`; *numbered lists* using `+` (or `1.`, `2.`, etc.).
- *External links* can be created using the `#link()` function.
- *Images* can be added using the `#image()` function.
- *Tables* can be created using the `#table()` function:
  ```typst
  #align(center,
    table(
      columns: 3,
      [Column 1],[Column 2],[Column 3],
      [#sym.star.filled],[#sym.square.filled],[#sym.circle.filled],
    )
  )
  ```
  #align(center, table(
    columns: 3,
    [Column 1], [Column 2], [Column 3],
    [#sym.star.filled], [#sym.square.filled], [#sym.circle.filled],
  ))
- *Figures* are created using the `#figure()` function. A caption can be added with the `caption` argument. You can add a label to a figure by enclosing the name in angular brackets following the function call:
  ```typst
  #align(center,
    [
      #figure(
        caption: "An example figure",
        [Some Content]
      ) <fig>
    ]
  )
  ```
  #align(center, [
    #figure(
      caption: "An example figure",
      [Some Content],
    ) <fig>
  ])
  - Labels can be referenced using an `@` symbol followed by the label name. Typst SSG will automatically convert this to a link to the appropriate location on the page.
  - For example, to reference the figure above, use `@fig`. Clicking @fig will take you to `Some Content`.
- *Inline code* can be created using backticks: ``` `code` ```. *Code blocks* use triple backticks:
  ````
  ```js
  function hello() {
    console.log("Hello, world!");
  }
  ```
  ````
- *Inline math* is wrapped in a `$` with no spaces: `$E = m c^2$` #sym.arrow $E = m c^2$; use a single space after the opening `$` and before the closing `$` for *display math*:
  ```typst
  $
  E = m c^2
  $
  ```
  #sym.arrow
  $
    E = m c^2
  $
- The *`let` keyword* is used to define variables and functions:
  ```typst
  #let square(x) = x * x

  The square of 5 is #square(5).
  ```

=== Formatting

- *Bold text* is created using single asterisks: `*bold*` #sym.arrow *bold*; *italic text* uses underscores: `_italic_` #sym.arrow _italic_
- *`set` rules* are used to define scoped formatting for different elements. For example:
  - `set text(size: 12pt, font: "Arial")` sets the text size and font.
  - `set page(margin: 2em)` sets the page margin.
  - `set heading(numbering: none)` disables automatic numbering for headings.
  - `#set enum(numbering: "1.a.i.", full: false)` customizes the appearance of numbered lists.
- *`show` rules* are used to customize the appearance of specific elements. For example:
  - `show link: it => underline(text(fill: rgb("#2980b9"))[#it])` customizes the appearance of links.
  - `show raw.where(block: true): it => block(...)` customizes the appearance of code blocks.
- You can use these rules in layouts to create a consistent style across your site.
- More formatting options can be found in the #link("https://typst.app/docs/reference/styling/")[Typst documentation].

=== Other Features

- *Visualization* functions can be used to draw shapes and paths. For example, to draw a circle:
  ```typst
  #align(
    center,
    circle(radius: 25pt)
  )
  ```
  #align(
    center,
    circle(radius: 25pt),
  )
  - See the #link("https://typst.app/docs/reference/visualize/circle/")[Typst documentation] for more information.
- *Introspection* functions allow you to access information about the document and its structure. This can be used to create content that reacts to its location in the document and to create and manage state. See the #link("https://typst.app/docs/reference/context/")[context documentation] and #link("https://typst.app/docs/reference/introspection/")[introspection documentation] for more information.
- *Packages* can be imported to extend Typst's functionality. For example, the #link("https://typst.app/universe/package/cetz")[CeTZ] package can be used to create complex diagrams, graphs, and charts.

#figure(
  caption: [#link("https://diagrams.janosh.dev/concave-functions")[Concave Functions Example using CeTZ Plot]],
  [
    #canvas({
      draw.set-style(axes: (
        y: (label: (anchor: "north-west", offset: -0.2), mark: (end: "stealth", fill: black)),
        x: (mark: (end: "stealth", fill: black)),
      ))
      plot.plot(
        size: (8, 4),
        x-min: 0,
        x-max: 1,
        x-label: $x$,
        y-tick-step: 0.2,
        x-tick-step: 0.2,
        x-grid: true,
        y-grid: true,
        legend: "inner-north-west",
        legend-style: (stroke: .5pt),
        axis-style: "left",
        {
          plot.add(style: (stroke: blue + 1.5pt), domain: (0, 1), label: $x$, x => x)
          plot.add(
            style: (stroke: red + 1.5pt),
            domain: (0.01, 1),
            samples: 100,
            label: $-x ln(x)$,
            x => -x * calc.ln(x),
          )
        },
      )
    })
  ],
)

== Documentation

- #link("https://typst.app/docs")[Typst Documentation]
- #link("https://github.com/k0src/Typst-SSG")[Typst SSG Documentation]
