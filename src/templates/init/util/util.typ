// Same-tab site link util function. Use this to create links on your site that open in the same tab.
// You can import the Typst SSG Util package in any Typst file to use this function as well.
// https://github.com/k0src/Typst-SSG-Util-Package

#let base-url = state("site-link-base", "")

#let set-base(url) = {
  base-url.update(url)
}

#let site-link(dest, ..body-args, same-tab: false) = context {
  let base = base-url.get()

  let full-dest = if base != "" and type(dest) == str {
    base + dest
  } else {
    dest
  }

  let actual-dest = if same-tab and type(full-dest) == str {
    "tssg:sametab:" + full-dest
  } else {
    full-dest
  }

  if body-args.pos().len() == 0 {
    if same-tab and type(full-dest) == str {
      link(actual-dest, full-dest)
    } else {
      link(actual-dest)
    }
  } else {
    link(actual-dest, body-args.pos().at(0))
  }
}