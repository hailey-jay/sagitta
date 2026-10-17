/// The diagram as a standalone SVG image, as the canvas draws it in light mode: each arrow's own
/// SVG, and each label's KaTeX, in a `foreignObject`, with KaTeX's styles and the fonts the labels
/// use embedded, so that the file shows the same without Sagitta or a network. Browsers draw it
/// faithfully; editors that ignore `foreignObject`, such as some vector editors, show the arrows
/// without their labels. The PDF tikz-cd makes remains the reference: this is for a slide or a
/// web page.
class DiagramSVG {
    /// The SVG's text.
    static async build(ui) {
        const canvas = ui.canvas.element;
        const origin = canvas.getBoundingClientRect();
        const scale = 2 ** ui.scale;
        // Where `element`'s box is on the canvas, unzoomed.
        const box = (element) => {
            const rect = element.getBoundingClientRect();
            return {
                x: (rect.left - origin.left) / scale,
                y: (rect.top - origin.top) / scale,
                width: rect.width / scale,
                height: rect.height / scale,
            };
        };
        // The box round what `element`, a shape in an arrow's SVG, draws on the canvas: the
        // screen's box round a rotated shape is the box round its rotated box, which is far too
        // big for a long route, so a path is followed along its length instead.
        const drawn = (element) => {
            const matrix = element.getScreenCTM();
            let points;
            if (element instanceof SVGGeometryElement && element.getTotalLength() > 0) {
                const length = element.getTotalLength();
                points = Array.from({ length: 65 }, (_, i) => element.getPointAtLength(length * i / 64));
            } else {
                const { x, y, width, height } = element.getBBox();
                points = [[x, y], [x + width, y], [x, y + height], [x + width, y + height]]
                    .map(([x, y]) => new DOMPoint(x, y));
            }
            const placed = points.map((point) => new DOMPoint(point.x, point.y)
                .matrixTransform(matrix));
            const xs = placed.map(({ x }) => (x - origin.left) / scale);
            const ys = placed.map(({ y }) => (y - origin.top) / scale);
            return {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
            };
        };
        const parts = [];
        const boxes = [];

        // The vertices' labels, under the arrows, as the canvas stacks them.
        for (const vertex of ui.quiver.all_cells().filter((cell) => cell.is_vertex())) {
            const label = vertex.element.query_selector(".label").element;
            if (vertex.label === "") {
                continue;
            }
            const at = box(label);
            boxes.push(at);
            parts.push(DiagramSVG.foreign(at, DiagramSVG.label(label, vertex.label_colour)));
        }

        // The arrows, in the order the canvas stacks them: those crossing over last.
        const edges = ui.quiver.all_cells().filter((cell) => cell.is_edge()
            && !cell.element.class_list.contains("invalid"));
        const elements = Array.from(canvas.querySelectorAll(".arrow"));
        const rank = (edge) => (edge.element.class_list.contains("crossing-over") ? 1 : 0);
        edges.sort((a, b) => rank(a) - rank(b)
            || elements.indexOf(a.element.element) - elements.indexOf(b.element.element));
        for (const edge of edges) {
            const svg = edge.arrow.svg.element;
            // What the arrow draws, rather than its SVG's own box, which has room to spare and
            // may not hold the label.
            boxes.push(...Array.from(svg.querySelectorAll("path, line, circle, foreignObject"))
                .filter((element) => element.closest("mask, defs, clipPath") === null
                    && !element.matches(".arrow-checkpoint, .arrow-checkpoint-handle"))
                .map(drawn)
                .filter(({ width, height }) => width > 0 || height > 0));
            parts.push(DiagramSVG.arrow(svg, box(edge.element.element), edge.label_colour));
        }

        if (boxes.length === 0) {
            throw new Error("There is nothing to draw: the diagram is empty.");
        }
        const MARGIN = 12;
        const left = Math.min(...boxes.map(({ x }) => x)) - MARGIN;
        const top = Math.min(...boxes.map(({ y }) => y)) - MARGIN;
        const width = Math.max(...boxes.map(({ x, width }) => x + width)) - left + MARGIN;
        const height = Math.max(...boxes.map(({ y, height }) => y + height)) - top + MARGIN;
        const number = (value) => Number(value.toFixed(2));
        return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"`
            + ` width="${number(width)}" height="${number(height)}"`
            + ` viewBox="${number(left)} ${number(top)} ${number(width)} ${number(height)}">\n`
            + `<style><![CDATA[\n${await DiagramSVG.styles()}\n]]></style>\n`
            + `${parts.join("\n")}\n</svg>\n`;
    }

    /// A copy of the label `element`, in the colour `colour`, with the size it is drawn at, which
    /// the canvas's own styles gave it.
    static label(element, colour) {
        const copy = element.cloneNode(true);
        copy.setAttribute("xmlns", "http://www.w3.org/1999/xhtml");
        copy.removeAttribute("class");
        copy.setAttribute("style", `font-size: ${getComputedStyle(element).fontSize};`
            + ` color: ${colour.css()}; white-space: nowrap; line-height: normal;`);
        return copy;
    }

    /// A `foreignObject` at `at`, holding `content`.
    static foreign(at, content) {
        return `<foreignObject x="${at.x}" y="${at.y}" width="${at.width + 1}"`
            + ` height="${at.height + 1}">${new XMLSerializer().serializeToString(content)}`
            + `</foreignObject>`;
    }

    /// A copy of the arrow `svg`, placed as the canvas places it within its arrow's box `at`: the
    /// canvas rotates it about a point with CSS, which becomes an SVG transform here. What only
    /// shows while editing (a route's checkpoint rings) is left out, and what the canvas colours
    /// by its styles is coloured outright.
    static arrow(svg, at, colour) {
        const copy = svg.cloneNode(true);
        for (const element of copy.querySelectorAll(".arrow-checkpoint, .arrow-checkpoint-handle")) {
            element.remove();
        }
        for (const path of copy.querySelectorAll(".arrow-crossing")) {
            path.setAttribute("stroke", "white");
        }
        for (const label of copy.querySelectorAll(".label")) {
            label.replaceWith(DiagramSVG.label(label, colour));
        }
        const style = getComputedStyle(svg);
        const [ox, oy] = style.transformOrigin.split(" ").map(parseFloat);
        const matrix = new DOMMatrix(style.transform === "none" ? undefined : style.transform);
        const placed = new DOMMatrix().translate(at.x + ox, at.y + oy).multiply(matrix)
            .translate(-ox, -oy);
        copy.removeAttribute("style");
        copy.setAttribute("overflow", "visible");
        const { a, b, c, d, e, f } = placed;
        return `<g transform="matrix(${[a, b, c, d, e, f].join(" ")})">`
            + `${new XMLSerializer().serializeToString(copy)}</g>`;
    }

    /// KaTeX's styles, with the fonts the labels use embedded, and those they do not left out.
    static async styles() {
        const sheet = Array.from(document.styleSheets)
            .find((sheet) => (sheet.href ?? "").endsWith("katex.css"));
        if (sheet === undefined) {
            return "";
        }
        // A weight may be named or numbered, depending on where it is read.
        const weight_of = (weight) => ({ "400": "normal", "700": "bold" })[weight] ?? weight;
        const loaded = new Set(Array.from(document.fonts)
            .filter((font) => font.status === "loaded")
            .map((font) => `${font.family.replace(/"/g, "")}|${font.style}|${
                weight_of(font.weight)}`));
        const rules = [];
        for (const rule of sheet.cssRules) {
            if (!(rule instanceof CSSFontFaceRule)) {
                rules.push(rule.cssText);
                continue;
            }
            const family = rule.style.getPropertyValue("font-family").replace(/"/g, "").trim();
            const style = rule.style.getPropertyValue("font-style") || "normal";
            const weight = rule.style.getPropertyValue("font-weight") || "normal";
            const key = `${family}|${style}|${weight_of(weight)}`;
            const url = /url\("?([^")]+\.woff2)"?\)/.exec(rule.style.getPropertyValue("src"));
            if (!loaded.has(key) || url === null) {
                continue;
            }
            const bytes = new Uint8Array(await (await fetch(new URL(url[1], sheet.href))).arrayBuffer());
            let binary = "";
            for (let i = 0; i < bytes.length; i += 0x8000) {
                binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
            }
            rules.push(`@font-face { font-family: ${family}; font-style: ${style};`
                + ` font-weight: ${weight}; src: url(data:font/woff2;base64,${btoa(binary)})`
                + ` format("woff2"); }`);
        }
        return rules.join("\n");
    }
}
