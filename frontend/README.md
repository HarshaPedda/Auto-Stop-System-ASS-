# BLACKBOX FACTORIES — Cut List Optimizer

**SolidWorks Weldment Cut List Optimizer with Assembly-Friendly IDs, Damaged Stock Handling, and Shop-Floor Tooling**

Solves the 1D Cutting Stock Problem (bin packing) for aluminum extrusion profiles exported from SolidWorks weldment features. Generates optimized cutting patterns, printable labels, and assembly guides designed for operators with zero experience.

---

## Project Structure

```
cut-list-optimizer/
├── README.md                           # This file
├── sw_advanced_optimizer.py            # Main Python CLI optimizer (production)
├── sw_cutlist_optimizer.py             # Simpler Python optimizer (basic version)
├── advanced-cut-optimizer.jsx          # React interactive UI (advanced)
├── cut-list-optimizer.jsx              # React interactive UI (basic version)
├── SW_ExportCutList_Advanced.bas       # SolidWorks VBA macro for cut list export
├── cut_labels.html                     # Generated: printable labels (HTML)
└── demo_optimized_report.csv           # Generated: sample output report
```

### File Roles

| File | Purpose | Tech |
|------|---------|------|
| `sw_advanced_optimizer.py` | **Primary CLI tool.** Reads SolidWorks CSV/Excel exports, runs BFD/FFD optimization, generates reports, labels, assembly guides. Handles damaged stock inventory. | Python 3.8+ (stdlib only) |
| `advanced-cut-optimizer.jsx` | **Interactive web UI.** Visual bar patterns, drag-to-add parts, CSV import, stock inventory with damage, printable labels tab, assembly guide tab, cost estimation. | React (JSX), runs in Claude Artifacts or any React env |
| `SW_ExportCutList_Advanced.bas` | **SolidWorks VBA macro.** Traverses CutListFolder features, exports Description, LENGTH, QUANTITY, ANGLE1/2, Zone, Bounding Box to CSV. | VBA (SolidWorks API) |
| `sw_cutlist_optimizer.py` | Basic version of the CLI optimizer. Fewer features, simpler code. Good reference for understanding the core algorithm. | Python 3.8+ |
| `cut-list-optimizer.jsx` | Basic version of the React UI. Core optimization only, no inventory or labels. | React (JSX) |

---

## Quick Start

### 1. Generate SolidWorks Export Macro

```bash
python sw_advanced_optimizer.py --generate-macro
```

This creates `SW_ExportCutList_Advanced.bas`. In SolidWorks:
1. Open your weldment part
2. **Tools → Macro → New** → paste the macro code
3. Run → CSV saved next to your `.sldprt` file

### 2. Run Optimizer on Exported CSV

```bash
# Basic usage
python sw_advanced_optimizer.py my_part_cutlist.csv --stock 6000 --kerf 3

# With warehouse inventory (damaged stock)
python sw_advanced_optimizer.py parts.csv --inventory stock.csv --kerf 3 --cost 8.5

# With printable labels
python sw_advanced_optimizer.py parts.csv --inventory stock.csv --kerf 3 --labels

# Demo mode (built-in sample data)
python sw_advanced_optimizer.py --demo --labels
```

### 3. CLI Arguments Reference

```
positional:
  input                   Parts CSV file (SolidWorks export)

options:
  --inventory, -i FILE    Stock inventory CSV (existing bars with damage info)
  --stock MM              Default stock bar length in mm (default: 6000)
  --kerf MM               Blade kerf width in mm (default: 3.0)
  --algorithm {best,first}  BFD or FFD algorithm (default: best)
  --cost $/m              Material cost per meter for new stock estimation
  --output, -o FILE       Output CSV report path
  --labels                Generate printable HTML labels alongside CSV
  --generate-macro        Output SolidWorks VBA macro file
  --demo                  Run with built-in sample data
```

---

## CSV Input Formats

### Parts CSV (SolidWorks Export)

Column detection is flexible — the parser matches common SolidWorks naming variations.

```csv
Profile,Length,Qty,Zone,Description
40x40 AL 6063,1200,4,FRAME,Top horizontal rail
40x40 AL 6063,800,6,FRAME,Vertical upright
20x40 AL 6063,600,8,BASE,Base cross member
40x80 AL 6063,1500,2,GANTRY,Gantry main beam
```

**Recognized column names:**
- Profile: `description`, `profile`, `name`, `part`, `item`
- Length: `length`, `len`, `size`
- Quantity: `qty`, `quantity`, `count`, `pcs`
- Zone: `zone`, `area`, `location`, `assy`, `assembly`
- Description: `note`, `comment`, `remark`

### Stock Inventory CSV

```csv
Profile,TotalLength,DamageStart,DamageEnd,Note
40x40 AL 6063,6000,0,150,Dent on right end
40x80 AL 6063,6000,80,0,Scratch left 80mm
40x80 AL 6063,3000,0,0,Clean offcut from previous job
```

**Recognized column names:**
- Profile: `profile`, `description`, `name`
- Length: `total`, `length`, `stock`
- Damage Start: `damage_start`, `dmg_start`, `dam_start`
- Damage End: `damage_end`, `dmg_end`, `dam_end`
- Note: `note`, `comment`, `remark`

---

## Unique ID System

The ID system is designed so that an assembly worker with no experience can match cut pieces to assembly locations using only a label and a drawing.

### Format: `ZONE-CodeSeq/PieceNum`

```
FRAME-A01/2
│     │││  │
│     │││  └─ Piece 2 of this part (when qty > 1)
│     ││└──── Sequence number (01, 02, ...)
│     │└───── Profile code (A = first profile, B = second, etc.)
│     └────── Separator
└──────────── Assembly zone (where this piece is installed)
```

### Bar Labels: `BAR-Code-Num`

```
BAR-A-02
│   │  │
│   │  └─ Bar number for this profile
│   └──── Profile code (matches part labels)
└──────── Prefix
```

### Assembly Zones

Predefined zones that map to machine/structure areas:

```
FRAME, BASE, GANTRY, CONVEYOR, GUARD, SUPPORT, BRACKET, DOOR, PANEL, ENCLOSURE, CUSTOM
```

### Shop Floor Workflow

1. **Cut Operator** reads `BAR-A-01` → knows which stock bar to load
2. Cuts pieces in position order (Pos 1, Pos 2, ...)
3. Writes label on each piece with marker: `FRAME-A01/1`, `FRAME-A01/2`, etc.
4. **Assembly Worker** receives pieces sorted by zone
5. Looks at drawing → finds zone "FRAME" → matches `FRAME-A01/2` → installs

---

## Algorithms

### Best Fit Decreasing (BFD) — Default

1. Sort all parts **longest first**
2. For each part, find the bar with the **least remaining space** that still fits
3. If no bar fits, open a new bar

**Why default:** Consolidates waste into fewer bars. Produces bars that are either nearly full or have large reusable offcuts.

### First Fit Decreasing (FFD)

1. Sort all parts **longest first**
2. For each part, place it in the **first bar** (left to right) that fits
3. If no bar fits, open a new bar

**When to use:** Slightly faster for very large part lists (>500 parts). Spreads waste more evenly.

### Damaged Stock Handling

When inventory bars have damaged ends:
1. Damaged length is subtracted from total length → `effective_length`
2. Inventory bars are tried **first** (before ordering new stock)
3. Inventory sorted by effective length descending (use biggest first)
4. Visual patterns show damage zones with hatched red sections

### Approximation Quality

Both algorithms guarantee at most `(11/9) × OPT + 1` bars where OPT is the theoretical minimum. In practice, results are typically within 1-2 bars of optimal.

**Lower bound formula:**
```
Minimum bars = ⌈ (Σ all part lengths + Σ kerf per cut) / stock_length ⌉
```

---

## Architecture — Python CLI

```
sw_advanced_optimizer.py
│
├── Data Models (dataclasses)
│   ├── Part              # Input part definition
│   ├── CutPiece          # Expanded individual piece with labels
│   ├── StockBar           # Bar containing cuts + damage info
│   └── StockEntry         # Inventory bar definition
│
├── Parsing
│   ├── parse_parts_csv()        # Flexible column matching
│   └── parse_inventory_csv()    # Damaged stock import
│
├── Optimizer
│   └── optimize_advanced()      # BFD/FFD with inventory-first strategy
│       ├── Expand parts by qty → CutPiece list
│       ├── Sort descending by length
│       ├── Create inventory bars (deduct damage)
│       ├── Place pieces (BFD or FFD)
│       ├── Assign bar labels + cut positions
│       └── Compute stats + offcuts
│
├── Reporting
│   ├── print_report()           # Console formatted report
│   ├── export_csv()             # Full CSV with assembly guide
│   └── generate_labels_html()   # Printable label cards
│
└── SolidWorks Integration
    └── generate_sw_macro()      # VBA macro code generation
```

### Key Functions

| Function | Input | Output | Notes |
|----------|-------|--------|-------|
| `optimize_advanced()` | parts, inventory, std_lengths, kerf, algo | (bars[], stats{}) | Core algorithm. Groups by profile. Inventory-first. |
| `parse_parts_csv()` | filepath | Part[] | Flexible column detection for SW exports |
| `parse_inventory_csv()` | filepath | StockEntry[] | Reads damage start/end values |
| `generate_labels_html()` | bars | HTML file | Print-ready labels with zone colors |
| `generate_sw_macro()` | — | .bas file | Exports LENGTH, QTY, ANGLE1/2, Zone, BBox |
| `export_csv()` | bars, stats | CSV file | Cut details + bar summary + assembly guide + offcuts |

---

## Architecture — React UI (JSX)

```
advanced-cut-optimizer.jsx
│
├── State
│   ├── parts[]              # Part definitions with zone, desc
│   ├── stockInventory[]     # Warehouse bars with damage
│   ├── standardLengths{}    # Per-profile stock lengths
│   ├── kerf, algorithm      # Optimization parameters
│   ├── costPerMeter         # Material cost
│   └── results              # Optimization output
│
├── Tabs
│   ├── Parts & Assembly     # CRUD table with preview IDs
│   ├── Stock Inventory      # Warehouse bars + damage + standard lengths
│   ├── Settings             # Kerf, algorithm, cost, ID system explainer
│   ├── Cut Patterns         # Visual bar diagrams + stats
│   ├── Assembly Guide       # Zone-grouped checklist for operators
│   └── Print Labels         # Grid of label cards (Ctrl+P to print)
│
├── Optimizer (inline)
│   ├── BFD / FFD with inventory-first
│   ├── Per-profile stock lengths
│   ├── Damage deduction
│   └── Offcut tracking (>100mm)
│
└── Export
    └── CSV with cut details + bar summary + offcuts + totals
```

### Dependencies (React UI)

- React (useState, useCallback, useRef, useMemo)
- No external libraries — zero dependencies beyond React core
- Tailwind NOT used — all inline styles for portability

---

## SolidWorks VBA Macro

### What It Exports

| Property | Source | Notes |
|----------|--------|-------|
| Description | CutListFolder → CustomPropertyManager | Profile name (e.g., "40x40 AL 6063") |
| LENGTH | Auto-resolved by SolidWorks | Strips "mm" suffix automatically |
| QUANTITY | Cut list item count | |
| Zone | Custom property "Zone" | User-defined; defaults to "FRAME" |
| ANGLE1 / ANGLE2 | Miter angle properties | Strips degree symbol |
| Bounding Box Width/Height | Auto-calculated by SW | For sheet metal / plate parts |

### Adding Custom Zone Property in SolidWorks

1. In FeatureManager, expand **Cut List** folder
2. Right-click a cut list item → **Properties**
3. Add new property: Name = `Zone`, Type = Text, Value = `FRAME` (or `BASE`, `GANTRY`, etc.)
4. The macro reads this and passes it through to the optimizer

---

## Development Guide (Claude Code)

### Extending the Optimizer

**Add a new algorithm** (e.g., ILP solver):
```python
# In sw_advanced_optimizer.py, add after best_fit_decreasing:

def ilp_solver(expanded, stock_length, kerf):
    """Exact solution using PuLP / OR-Tools."""
    # pip install pulp
    import pulp
    # ... implement column generation or branch-and-bound
    pass
```

Then add `"ilp"` to the algorithm choices in `argparse` and the optimizer dispatch.

**Add a new zone:**
```python
# Just use it in the CSV — no code changes needed.
# The ID system auto-assigns any zone string.
# To add a color in the React UI, update ZONE_COLORS:
ZONE_COLORS = {
    ...
    "MOTOR": "#FF6B6B",
}
```

**Add Excel support for inventory:**
```python
# parse_inventory_csv() already handles CSV.
# For Excel, add openpyxl parsing similar to the basic version.
```

### Testing Checklist

```bash
# Basic functionality
python sw_advanced_optimizer.py --demo
python sw_advanced_optimizer.py --demo --labels
python sw_advanced_optimizer.py --generate-macro

# With actual files
python sw_advanced_optimizer.py parts.csv --stock 6000 --kerf 3
python sw_advanced_optimizer.py parts.csv --inventory stock.csv --kerf 3 --cost 8.5 --labels

# Edge cases to test
# - Part longer than stock length (should warn)
# - Single part, qty=1
# - All parts same length
# - Empty inventory
# - All inventory damaged (effective_length very small)
# - 100+ unique parts
# - Mixed profiles with different standard lengths
```

### Common Modifications

**Change stock lengths for a supplier (e.g., Misumi):**
```bash
# Misumi ships 4000mm and 6100mm
python sw_advanced_optimizer.py parts.csv --stock 6100 --kerf 2.5
```

Or in the React UI, update `standardLengths` per profile in the Stock Inventory tab.

**Adjust kerf for different saws:**
- Chop saw (aluminum): 2.5–3.0 mm
- Band saw: 1.0–1.5 mm
- Laser: 0.2–0.5 mm
- Water jet: 0.8–1.2 mm

**Add miter angle support to optimizer:**
Currently exported by the macro but not used in optimization. To account for miter cuts consuming extra material, modify the piece length before packing:
```python
# Miter angles consume extra material at each end
import math
extra = profile_width * math.tan(math.radians(angle)) # per angled end
effective_cut_length = part_length + extra
```

---

## Output Files Reference

### CSV Report Sections

1. **CUT DETAILS** — Every individual piece with label, zone, profile, length, bar assignment, position
2. **BAR SUMMARY** — Each bar: stock length, effective length, damage, cuts, waste, efficiency, source (INVENTORY/NEW)
3. **ASSEMBLY GUIDE** — Grouped by zone, numbered checklist format
4. **REUSABLE OFFCUTS** — Waste pieces >100mm that can be stored for future jobs
5. **TOTALS** — Bar count, inventory vs new, efficiency, material cost

### HTML Labels

- Print-ready grid layout (3 columns)
- Each label shows: Piece ID, Zone (color-coded), Profile, Length, Bar source, Cut position, Description
- `@media print` CSS for clean printing
- Use Ctrl+P or the Print button

---

## Roadmap / Future Features

- [ ] ILP exact solver (PuLP/OR-Tools) for guaranteed minimum bars
- [ ] Multi-length stock optimization (try 3m vs 6m and pick cheapest)
- [ ] QR code generation on labels (encode piece ID + metadata)
- [ ] SolidWorks API integration (COM automation instead of macro)
- [ ] Offcut database — persist reusable offcuts across jobs
- [ ] Assembly drawings — auto-annotate SolidWorks drawings with cut IDs
- [ ] Nesting history — track material usage over time
- [ ] Multi-machine support — different kerf per saw
- [ ] Batch mode — process multiple part files in one run
- [ ] Web server mode (Flask/FastAPI) for shop floor tablets

---

## Dependencies

### Python CLI
- **Python 3.8+**
- **Standard library only** — no pip installs required
- Optional: `openpyxl` for Excel file reading (`pip install openpyxl`)

### React UI
- **React 18+** (useState, useCallback, useRef, useMemo)
- No external dependencies

### SolidWorks Macro
- **SolidWorks 2018+** with Weldment features
- VBA macro environment (built into SolidWorks)

---

## License

Internal tooling — Blackbox Factories.
