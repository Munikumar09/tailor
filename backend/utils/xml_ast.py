import zipfile
import lxml.etree as ET
import os
import re
from utils.logger import get_logger

logger = get_logger(__name__)

NSMAP = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}


def get_xml_node_as_string(node):
    if node is None:
        return ""
    return ET.tostring(node, encoding="unicode")


def _extract_font_size(rpr_xml: str):
    """Return font size in points from rPr XML, or None if not specified."""
    if not rpr_xml:
        return None
    try:
        rPr = ET.fromstring(rpr_xml)
        sz = rPr.find("w:sz", namespaces=NSMAP)
        if sz is not None:
            val = sz.get("{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val")
            if val and val.isdigit():
                return int(val) // 2  # half-points → points
    except Exception:
        pass
    return None


def _extract_underline(rpr_xml: str) -> bool:
    """Return True if underline is active in rPr XML."""
    if not rpr_xml:
        return False
    try:
        rPr = ET.fromstring(rpr_xml)
        u = rPr.find("w:u", namespaces=NSMAP)
        if u is not None:
            val = u.get(
                "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val", "single"
            )
            return val not in ("none", "")
    except Exception:
        pass
    return False


def parse_docx_to_block_ast(filepath):
    """
    1. PARSER -> Block AST
    Paragraph-level granularity.
    Each block: { id, type, pStyle, ilvl, fullText, runs, pPrXml, baseRprXml, isTailorable }
    """
    if not os.path.exists(filepath):
        return {"blocks": []}

    with zipfile.ZipFile(filepath, "r") as z:
        xml_content = z.read("word/document.xml")

    root = ET.fromstring(xml_content)

    blocks = []
    for p_idx, p in enumerate(root.findall(".//w:p", namespaces=NSMAP)):
        # Paragraph properties
        pPr = p.find("w:pPr", namespaces=NSMAP)
        pPrXml = get_xml_node_as_string(pPr)

        # Style and List level
        pStyle = ""
        if pPr is not None:
            style_node = pPr.find("w:pStyle", namespaces=NSMAP)
            if style_node is not None:
                pStyle = style_node.get(
                    "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val",
                    "",
                )

        numPr = pPr.find("w:numPr", namespaces=NSMAP) if pPr is not None else None
        ilvl = 0
        if numPr is not None:
            ilvl_node = numPr.find("w:ilvl", namespaces=NSMAP)
            if ilvl_node is not None:
                ilvl = int(
                    ilvl_node.get(
                        "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val",
                        "0",
                    )
                )

        # Classify type
        sl = pStyle.lower()
        block_type = "paragraph"
        if any(h in sl for h in ["heading1", "title"]) or sl == "1":
            block_type = "h1"
        elif "heading2" in sl or sl == "2":
            block_type = "h2"
        elif "heading3" in sl or sl == "3":
            block_type = "h3"
        elif numPr is not None:
            block_type = "bullet"

        runs = []
        full_text_parts = []
        baseRprXml = ""

        for r_idx, r in enumerate(p.findall("w:r", namespaces=NSMAP)):
            t_node = r.find("w:t", namespaces=NSMAP)
            if t_node is not None and t_node.text:
                rPr = r.find("w:rPr", namespaces=NSMAP)
                rPrXml = get_xml_node_as_string(rPr)

                if not baseRprXml:
                    baseRprXml = rPrXml

                text = t_node.text
                full_text_parts.append(text)
                runs.append(
                    {
                        "id": f"b{p_idx}_r{r_idx}",
                        "text": text,
                        "rPrXml": rPrXml,
                        "bold": (
                            rPr.find("w:b", namespaces=NSMAP) is not None
                            if rPr is not None
                            else False
                        ),
                        "italic": (
                            rPr.find("w:i", namespaces=NSMAP) is not None
                            if rPr is not None
                            else False
                        ),
                        "underline": _extract_underline(rPrXml),
                        "fontSize": _extract_font_size(rPrXml),
                    }
                )

        full_text = "".join(full_text_parts)

        if full_text.strip():
            blocks.append(
                {
                    "id": f"b{p_idx}",
                    "type": block_type,
                    "pStyle": pStyle,
                    "ilvl": ilvl,
                    "fullText": full_text,
                    "runs": runs,
                    "pPrXml": pPrXml,
                    "baseRprXml": baseRprXml,
                    "isTailorable": (block_type in ["bullet", "paragraph"])
                    and len(full_text.strip()) > 15,
                }
            )

    return {"blocks": blocks}


def rebuild_paragraph(p_node, new_text, base_rpr_xml, emphasize_keywords=None):
    """
    6. RUN REBUILDER
    """
    # Remove all run-bearing children
    to_remove = []
    for child in p_node:
        tag = child.tag.split("}")[-1]
        if tag in ["r", "hyperlink", "ins", "del", "bookmarkStart", "bookmarkEnd"]:
            to_remove.append(child)

    for child in to_remove:
        p_node.remove(child)

    if emphasize_keywords:
        keywords = sorted(emphasize_keywords, key=len, reverse=True)
        pattern = "|".join([re.escape(k) for k in keywords])
        segments = re.split(f"({pattern})", new_text, flags=re.IGNORECASE)

        for i, seg in enumerate(segments):
            if not seg:
                continue
            is_kw = i % 2 == 1  # captured group
            add_run(p_node, seg, base_rpr_xml, bold=is_kw)
    else:
        add_run(p_node, new_text, base_rpr_xml)


def add_run(p_node, text, base_rpr_xml, bold=False):
    r_node = ET.SubElement(
        p_node, "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}r"
    )

    if base_rpr_xml:
        try:
            # Wrap in root to handle fragment
            rpr_node = ET.fromstring(base_rpr_xml)
            r_node.append(rpr_node)
        except:
            pass

    if bold:
        rPr = r_node.find("w:rPr", namespaces=NSMAP)
        if rPr is None:
            rPr = ET.SubElement(
                r_node,
                "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}rPr",
            )
        if rPr.find("w:b", namespaces=NSMAP) is None:
            ET.SubElement(
                rPr, "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}b"
            )

    t_node = ET.SubElement(
        r_node, "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}t"
    )
    t_node.set("{http://www.w3.org/XML/1998/namespace}space", "preserve")
    t_node.text = text


def export_mutated_docx(
    master_path, output_path, modifications, emphasize_keywords=None
):
    """
    7. EXPORTER
    """
    with zipfile.ZipFile(master_path, "r") as zin:
        with zipfile.ZipFile(output_path, "w") as zout:
            for item in zin.infolist():
                if item.filename == "word/document.xml":
                    xml_content = zin.read(item.filename)
                    root = ET.fromstring(xml_content)

                    p_nodes = root.findall(".//w:p", namespaces=NSMAP)
                    for block_id, new_text in modifications.items():
                        try:
                            p_idx = int(block_id[1:])  # "b14" -> 14
                            if p_idx < len(p_nodes):
                                p_node = p_nodes[p_idx]

                                # Extract baseRpr from first run
                                first_r = p_node.find("w:r", namespaces=NSMAP)
                                base_rpr = ""
                                if first_r is not None:
                                    rPr = first_r.find("w:rPr", namespaces=NSMAP)
                                    base_rpr = get_xml_node_as_string(rPr)

                                rebuild_paragraph(
                                    p_node, new_text, base_rpr, emphasize_keywords
                                )
                        except:
                            continue

                    modified_xml = ET.tostring(
                        root, encoding="utf-8", xml_declaration=True
                    )
                    zout.writestr(item, modified_xml)
                else:
                    zout.writestr(item, zin.read(item.filename))
    return output_path
