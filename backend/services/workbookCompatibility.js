import JSZip from "jszip";

const spreadsheetNamespace = 'xmlns:x="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

export async function normalizeSpreadsheetNamespaces(buffer) {
  const zip = await JSZip.loadAsync(buffer);
  let changed = false;
  for (const [name, entry] of Object.entries(zip.files)) {
    if (!name.startsWith("xl/") || !name.endsWith(".xml") || entry.dir) continue;
    let xml = await entry.async("string");
    if (!xml.includes(spreadsheetNamespace)) continue;
    xml = xml.replace(/(<\/?)(?:x:)/g, "$1").replace(/xmlns:x=/g, "xmlns=");
    zip.file(name, xml);
    changed = true;
  }
  return changed ? zip.generateAsync({ type: "nodebuffer" }) : buffer;
}
