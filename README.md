# ui5-plugin-persist-selection

[![npm version](https://img.shields.io/npm/v/ui5-plugin-persist-selection)](https://www.npmjs.com/package/ui5-plugin-persist-selection)
[![license](https://img.shields.io/github/license/AbhilashBiradar/ui5-plugin-persist-selection)](./LICENSE)

> A `sap.ui.table.Table` selection plugin that **preserves row selections across sort and filter operations** — by tracking binding context paths instead of row indices.

---

## The Problem

Standard UI5 selection plugins (`MultiSelectionPlugin`, `SelectionModelSelection`) store selections as **row indices**. When a user sorts or filters the table, row indices shift — the selection is lost.

This is a well-known frustration in enterprise UI5 applications. This plugin solves it.

---

## How It Works

`PersistSelectionPlugin` extends `sap.ui.table.plugins.SelectionPlugin` — the official plugin base class introduced in UI5 1.64. Instead of storing indices, it stores the **binding context path** of each selected row (`/Products(1)`, `/Orders(42)`, etc.).

Context paths are stable — they survive sort, filter, and pagination. After a sort or filter, the plugin re-resolves which visible rows are selected by matching their context paths.

---

## Requirements

- SAPUI5 / OpenUI5 **>= 1.64.0** (when `SelectionPlugin` was introduced)
- `sap.ui.table.Table`, `sap.ui.table.TreeTable`, or `sap.ui.table.AnalyticalTable`
- Does **not** work with `sap.m.Table`

---

## Installation

```bash
npm install ui5-plugin-persist-selection
```

---

## Usage

### JavaScript

```js
sap.ui.require([
    "sap/ui/table/Table",
    "ui5-plugin-persist-selection/src/PersistSelectionPlugin"
], function (Table, PersistSelectionPlugin) {

    const oPlugin = new PersistSelectionPlugin({
        selectionMode: "MultiToggle",
        selectionChange: function (oEvent) {
            const aPaths = oEvent.getParameter("contextPaths");
            console.log("Selected paths:", aPaths);
            // aPaths remain stable after sort/filter
        }
    });

    const oTable = new Table({
        dependents: [oPlugin],
        columns: [ /* ... */ ],
        rows: { path: "/Products" }
    });
});
```

### XML View

```xml
<table:Table
    xmlns:table="sap.ui.table"
    xmlns:plugins="com.abhilashbiradar"
    rows="{/Products}">
    <table:dependents>
        <plugins:PersistSelectionPlugin
            selectionMode="MultiToggle"
            selectionChange=".onSelectionChange"/>
    </table:dependents>
    <table:columns>
        <!-- columns -->
    </table:columns>
</table:Table>
```

---

## API

### Properties

| Property | Type | Default | Description |
|---|---|---|---|
| `selectionMode` | `sap.ui.table.SelectionMode` | `MultiToggle` | `MultiToggle` or `Single` |
| `limit` | `int` | `0` | Max selectable rows. `0` = unlimited |

### Events

| Event | Parameters | Description |
|---|---|---|
| `selectionChange` | `contextPaths: string[]`, `rowIndices: int[]`, `trigger: string` | Fired when selection changes. `trigger` is `"user"` or `"sortFilter"` |

### Methods

| Method | Returns | Description |
|---|---|---|
| `getSelectedContextPaths()` | `string[]` | Stable context paths of selected rows |
| `getSelectedIndices()` | `int[]` | Current row indices (shift after sort/filter) |
| `setSelectedContextPaths(paths)` | `void` | Programmatically select by context path |
| `clearSelection()` | `void` | Deselect all rows |
| `selectAll()` | `void` | Select all visible rows |
| `getSelectedCount()` | `int` | Number of selected rows |
| `PersistSelectionPlugin.findOn(oTable)` | `PersistSelectionPlugin` | Find the plugin instance on a table |

---

## vs MultiSelectionPlugin

| Feature | `MultiSelectionPlugin` | `PersistSelectionPlugin` |
|---|---|---|
| Selection survives sort | ✗ Cleared | ✓ Preserved |
| Selection survives filter | ✗ Cleared | ✓ Preserved |
| Works with OData V4 | ✓ | ✓ |
| Works with JSON model | ✓ | ✓ |
| Range selection (shift+click) | ✓ | ✓ |
| Select All | ✓ | ✓ (visible rows) |
| Selection limit | ✓ | ✓ |
| Stable selection reference | index (unstable) | context path (stable) |

---

## Contributing

Bug reports and feature requests → [GitHub Issues](https://github.com/AbhilashBiradar/ui5-plugin-persist-selection/issues)

💬 Questions and ideas → [GitHub Discussions](https://github.com/AbhilashBiradar/ui5-plugin-persist-selection/discussions)

---

## License

MIT © [Abhilash Biradar](https://github.com/AbhilashBiradar)
