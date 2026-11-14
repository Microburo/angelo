// Typography board: one row per text style (meta column + sample), display then paragraph cards.
const SAMPLE = "A system that grows with every project";
const c = await H.cursor();
const body = null;
for (const kind of ["Display", "Paragraph"]) {
  const k = await card(body, kind, kind === "Paragraph" ? `Inter · Regular, Medium · ${CUI ? "line height in px" : LH.Paragraph + " %"}` : `${DISPLAY_FONT.family} · ${DISPLAY_FONT.style} · ${LH.Display} %`, { w: 1200 });
  const names = Object.keys(TS).filter((n) => n.startsWith(kind + "/")).sort((a, b) => TS[b].fontSize - TS[a].fontSize); // largest first
  for (const n of names) {
    const row = box(n, { dir: "row", gap: 24, cross: "CENTER" });
    const meta = box("meta", { gap: 4, w: 180 });
    add(meta, await text(n.replace("/", " / "), "Paragraph/Mini Medium", "text/primary", "name"), { w: "fill" });
    const st = TS[n];
    add(meta, await text(`${st.fontSize} px · ${Math.round(st.lineHeight.unit === "PIXELS" ? st.lineHeight.value : (st.fontSize * LH[kind]) / 100)} px`, "Paragraph/Mini Regular", "text/secondary", "value"), { w: "fill" });
    row.appendChild(meta);
    add(row, await text(SAMPLE, n, "text/primary", "sample"), { w: "fill" });
    add(k.card, row, { w: "fill" });
  }
  await burst(c, k.wrap);
}
c.done();
return { styles: Object.keys(TS).length };
