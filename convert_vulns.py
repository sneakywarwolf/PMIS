import pandas as pd
import json

df = pd.read_excel(r'C:\Users\Nirmal Chakraborty\Documents\Kimi\Workspaces\PMIS\Vulnerability-DB.xlsx')

# Clean up column names
df.columns = df.columns.str.strip()

# Select relevant columns
vulns = []
for _, row in df.iterrows():
    name = row.get('Name') or row.get('name')
    if not name or pd.isna(name):
        continue
    vulns.append({
        'name': str(name).strip(),
        'severity': str(row.get('Severity', 'Low')).strip() if pd.notna(row.get('Severity')) else 'Low',
        'cvssScore': float(row['CVSS']) if pd.notna(row.get('CVSS')) else None,
        'cvssVector': str(row['CVSS-VEC']).strip() if pd.notna(row.get('CVSS-VEC')) else None,
        'description': str(row.get('Description', '')).strip() if pd.notna(row.get('Description')) else '',
        'impact': str(row.get('Impact', '')).strip() if pd.notna(row.get('Impact')) else '',
        'remediation': str(row.get('Remediation', '')).strip() if pd.notna(row.get('Remediation')) else '',
        'references': str(row.get('References', '')).strip() if pd.notna(row.get('References')) else '',
    })

output_path = r'C:\Users\Nirmal Chakraborty\Documents\Kimi\Workspaces\PMIS\vapt-command-center\apps\backend\prisma\vulnerabilities.json'
with open(output_path, 'w', encoding='utf-8') as f:
    json.dump(vulns, f, indent=2, ensure_ascii=False)

print(f'✅ Exported {len(vulns)} vulnerabilities to vulnerabilities.json')
