import sys
from pbixray import PBIXRay
import pandas as pd
m = PBIXRay(sys.argv[1])
for t in m.tables:
    df = m.get_table(t)
    for c in df.columns:
        s = df[c]; nn = s.notna().sum()
        if pd.api.types.is_datetime64_any_dtype(s):
            tot = ((s.dropna() - pd.Timestamp("1899-12-30")).dt.total_seconds()/86400).sum()
        elif pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s):
            tot = float(s.dropna().astype(float).sum())
        else:
            tot = float(s.dropna().astype(str).str.len().sum())
        print(f"CK {t}|{c}|{nn}|{tot:.4f}")
