import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

def extract_yellow_highlighted_text(docx_path):
    """Extract text that has yellow highlighting from a DOCX file."""
    with zipfile.ZipFile(docx_path, 'r') as z:
        xml_content = z.read('word/document.xml')
    
    root = ET.fromstring(xml_content)
    
    # WordprocessingML namespace
    ns = {'w': 'http://schemas.openxmlformats.org/wordprocessingml/2006/main'}
    
    highlighted_texts = []
    
    # Find all paragraphs
    paragraphs = root.findall('.//w:p', ns)
    
    for para in paragraphs:
        # Get all runs in this paragraph
        runs = para.findall('.//w:r', ns)
        para_highlighted = []
        
        for run in runs:
            # Check if this run has yellow highlighting
            rPr = run.find('w:rPr', ns)
            is_yellow = False
            if rPr is not None:
                highlight = rPr.find('w:highlight', ns)
                if highlight is not None:
                    val = highlight.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}val')
                    if val and val.lower() in ('yellow', 'lightyellow', 'gold'):
                        is_yellow = True
                # Also check for shading
                shading = rPr.find('w:shd', ns)
                if shading is not None:
                    fill = shading.get('{http://schemas.openxmlformats.org/wordprocessingml/2006/main}fill')
                    if fill and fill.upper() in ('FFFF00', 'FFEE00', 'FFD700', 'FFEF00'):
                        is_yellow = True
            
            if is_yellow:
                texts = run.findall('.//w:t', ns)
                for t in texts:
                    if t.text:
                        para_highlighted.append(t.text)
        
        if para_highlighted:
            highlighted_texts.append(''.join(para_highlighted))
    
    return highlighted_texts


def analyze_all_templates(base_path):
    base = Path(base_path)
    
    for category_dir in sorted(base.iterdir()):
        if not category_dir.is_dir():
            continue
        
        print(f"\n{'='*70}")
        print(f"CATEGORY: {category_dir.name}")
        print(f"{'='*70}")
        
        for docx_file in sorted(category_dir.glob('*.docx')):
            print(f"\n--- Template: {docx_file.name} ---")
            try:
                highlights = extract_yellow_highlighted_text(docx_file)
                if highlights:
                    print(f"Found {len(highlights)} yellow-highlighted field(s):")
                    for i, h in enumerate(highlights, 1):
                        # Clean up the text
                        cleaned = h.strip().replace('\n', ' ').replace('\r', '')
                        if cleaned:
                            print(f"  {i}. {cleaned}")
                else:
                    print("  No yellow-highlighted fields found.")
            except Exception as e:
                print(f"  ERROR: {e}")


if __name__ == '__main__':
    template_dir = r'C:/Users/Nirmal Chakraborty/Documents/Kimi/Workspaces/PMIS/vapt-command-center/Report Template'
    analyze_all_templates(template_dir)
