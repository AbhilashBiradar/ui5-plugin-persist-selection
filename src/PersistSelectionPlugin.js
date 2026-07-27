/*!
 * ui5-plugin-persist-selection
 * SAP UI5 table plugin that preserves row selections across sort and filter operations.
 *
 * Copyright (c) 2026 Abhilash Biradar
 * Licensed under MIT License
 * https://github.com/AbhilashBiradar/ui5-plugin-persist-selection
 */
sap.ui.define([
    "sap/ui/table/plugins/SelectionPlugin",
    "sap/ui/table/utils/TableUtils"
], function (SelectionPlugin, TableUtils) {
    "use strict";

    /**
     * @class PersistSelectionPlugin
     *
     * A selection plugin for sap.ui.table.Table that preserves row selections
     * across sort and filter operations by tracking binding context paths
     * instead of row indices.
     *
     * Standard UI5 plugins (MultiSelectionPlugin, SelectionModelSelection) clear
     * the selection on every sort/filter because row indices shift. This plugin
     * stores the binding context path of each selected row and re-resolves
     * selections after the binding refreshes — keeping selections stable.
     *
     * @extends sap.ui.table.plugins.SelectionPlugin
     * @since 1.64.0
     *
     * Usage:
     *   oTable.addDependent(new PersistSelectionPlugin());
     *
     * @author Abhilash Biradar
     */
    const PersistSelectionPlugin = SelectionPlugin.extend(
        "com.abhilashbiradar.PersistSelectionPlugin",
        {
            metadata: {
                library: "com.abhilashbiradar",
                properties: {
                    /**
                     * Selection mode. Only MultiToggle and Single are supported.
                     * @type {sap.ui.table.SelectionMode}
                     */
                    selectionMode: {
                        type: "sap.ui.table.SelectionMode",
                        defaultValue: "MultiToggle"
                    },
                    /**
                     * Maximum number of rows that can be selected simultaneously.
                     * 0 means unlimited.
                     * @type {int}
                     */
                    limit: {
                        type: "int",
                        defaultValue: 0
                    }
                },
                events: {
                    /**
                     * Fired when the selection changes.
                     * @param {string[]} contextPaths - Binding context paths of all selected rows
                     * @param {int[]} rowIndices - Current row indices of selected rows (may change after sort/filter)
                     * @param {string} trigger - What triggered the change: "user" | "sortFilter"
                     */
                    selectionChange: {
                        parameters: {
                            contextPaths: { type: "string[]" },
                            rowIndices:   { type: "int[]" },
                            trigger:      { type: "string" }
                        }
                    }
                }
            }
        }
    );

    // Inherit the static findOn lookup so consumers can call:
    // PersistSelectionPlugin.findOn(oTable)
    PersistSelectionPlugin.findOn = SelectionPlugin.findOn;

    // ─── Internal state ───────────────────────────────────────────────────────

    /**
     * Set of binding context paths that are currently selected.
     * Using context paths (not indices) means selections survive sort/filter.
     * @type {Set<string>}
     */
    PersistSelectionPlugin.prototype._oSelectedPaths = null;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype.init = function () {
        SelectionPlugin.prototype.init.apply(this, arguments);
        this._oSelectedPaths = new Set();
    };

    PersistSelectionPlugin.prototype.onActivate = function (oTable) {
        SelectionPlugin.prototype.onActivate.apply(this, arguments);

        oTable.setProperty("selectionMode", this.getSelectionMode());

        // Listen for binding attachment so we can hook into sort/filter events
        TableUtils.Hook.register(
            oTable,
            TableUtils.Hook.Keys.Table.RowsBound,
            this._onRowsBound,
            this
        );

        TableUtils.Hook.register(
            oTable,
            TableUtils.Hook.Keys.Table.RowsUnbound,
            this._onRowsUnbound,
            this
        );

        // Attach to existing binding if table already has one
        const oBinding = oTable.getBinding("rows");
        if (oBinding) {
            this._attachBinding(oBinding);
        }
    };

    PersistSelectionPlugin.prototype.onDeactivate = function (oTable) {
        SelectionPlugin.prototype.onDeactivate.apply(this, arguments);

        oTable.setProperty("selectionMode", "None");

        TableUtils.Hook.deregister(
            oTable,
            TableUtils.Hook.Keys.Table.RowsBound,
            this._onRowsBound,
            this
        );

        TableUtils.Hook.deregister(
            oTable,
            TableUtils.Hook.Keys.Table.RowsUnbound,
            this._onRowsUnbound,
            this
        );

        const oBinding = oTable.getBinding("rows");
        if (oBinding) {
            this._detachBinding(oBinding);
        }
    };

    PersistSelectionPlugin.prototype.exit = function () {
        this._oSelectedPaths.clear();
    };

    // ─── Required abstract method implementations ─────────────────────────────

    /**
     * Called by the table when a row is clicked or keyboard-toggled.
     * @param {sap.ui.table.Row} oRow
     * @param {boolean} bSelected
     * @param {object} mConfig - { range: boolean } for shift+click range
     */
    PersistSelectionPlugin.prototype.setSelected = function (oRow, bSelected, mConfig) {
        const oContext = oRow.getBindingContext();
        if (!oContext) {
            return;
        }

        const sPath = oContext.getPath();

        if (this.getSelectionMode() === "Single") {
            // Single mode — replace entire selection
            this._oSelectedPaths.clear();
            if (bSelected) {
                this._oSelectedPaths.add(sPath);
            }
        } else if (mConfig && mConfig.range) {
            // Range selection (shift+click) — select all rows between last selected and this
            this._selectRange(oRow, bSelected);
            return; // _selectRange fires the event itself
        } else {
            // MultiToggle — toggle this row
            if (bSelected) {
                const iLimit = this.getLimit();
                if (iLimit > 0 && this._oSelectedPaths.size >= iLimit) {
                    return; // limit reached — ignore
                }
                this._oSelectedPaths.add(sPath);
            } else {
                this._oSelectedPaths.delete(sPath);
            }
        }

        this._fireSelectionChange("user");
    };

    /**
     * Called by the table for each rendered row to determine visual selection state.
     * @param {sap.ui.table.Row} oRow
     * @returns {boolean}
     */
    PersistSelectionPlugin.prototype.isSelected = function (oRow) {
        const oContext = oRow.getBindingContext();
        if (!oContext) {
            return false;
        }
        return this._oSelectedPaths.has(oContext.getPath());
    };

    /**
     * Called for the row drag ghost count and header selector state.
     * @returns {int}
     */
    PersistSelectionPlugin.prototype.getSelectedCount = function () {
        return this._oSelectedPaths.size;
    };

    // ─── Header selector (select all / deselect all) ──────────────────────────

    PersistSelectionPlugin.prototype.handleHeaderSelectorPress = function () {
        if (this._oSelectedPaths.size > 0) {
            this.clearSelection();
        } else {
            this.selectAll();
        }
        return Promise.resolve();
    };

    PersistSelectionPlugin.prototype.handleKeyboardShortcut = function (sType) {
        if (sType === "toggle") {
            this.handleHeaderSelectorPress();
        } else if (sType === "clear") {
            this.clearSelection();
        }
        return Promise.resolve();
    };

    // ─── Public selection API ─────────────────────────────────────────────────

    /**
     * Returns the binding context paths of all selected rows.
     * These paths remain stable across sort and filter operations.
     * @returns {string[]}
     */
    PersistSelectionPlugin.prototype.getSelectedContextPaths = function () {
        return Array.from(this._oSelectedPaths);
    };

    /**
     * Returns the current row indices of selected rows.
     * Note: these indices change after sort/filter — use getSelectedContextPaths()
     * for stable references.
     * @returns {int[]}
     */
    PersistSelectionPlugin.prototype.getSelectedIndices = function () {
        const oTable = this.getControl();
        if (!oTable) {
            return [];
        }
        const aIndices = [];
        oTable.getRows().forEach(function (oRow) {
            const oContext = oRow.getBindingContext();
            if (oContext && this._oSelectedPaths.has(oContext.getPath())) {
                aIndices.push(oRow.getIndex());
            }
        }, this);
        return aIndices;
    };

    /**
     * Programmatically select rows by their binding context paths.
     * @param {string|string[]} vPaths - Single path or array of paths
     */
    PersistSelectionPlugin.prototype.setSelectedContextPaths = function (vPaths) {
        const aPaths = Array.isArray(vPaths) ? vPaths : [vPaths];
        this._oSelectedPaths.clear();
        aPaths.forEach(function (sPath) {
            this._oSelectedPaths.add(sPath);
        }, this);
        this._fireSelectionChange("user");
    };

    /**
     * Clears all selections.
     */
    PersistSelectionPlugin.prototype.clearSelection = function () {
        if (this._oSelectedPaths.size === 0) {
            return;
        }
        this._oSelectedPaths.clear();
        this._fireSelectionChange("user");
    };

    /**
     * Selects all currently visible rows.
     * For large datasets, consider using setSelectedContextPaths() with fetched contexts.
     */
    PersistSelectionPlugin.prototype.selectAll = function () {
        if (this.getSelectionMode() === "Single") {
            return;
        }
        const oTable = this.getControl();
        if (!oTable) {
            return;
        }
        oTable.getRows().forEach(function (oRow) {
            const oContext = oRow.getBindingContext();
            if (oContext) {
                this._oSelectedPaths.add(oContext.getPath());
            }
        }, this);
        this._fireSelectionChange("user");
    };

    // ─── Binding event handlers ───────────────────────────────────────────────

    PersistSelectionPlugin.prototype._onRowsBound = function (oBinding) {
        this._attachBinding(oBinding);
    };

    PersistSelectionPlugin.prototype._onRowsUnbound = function () {
        const oTable = this.getControl();
        const oBinding = oTable && oTable.getBinding("rows");
        if (oBinding) {
            this._detachBinding(oBinding);
        }
    };

    PersistSelectionPlugin.prototype._attachBinding = function (oBinding) {
        oBinding.attachChange(this._onBindingChange, this);
    };

    PersistSelectionPlugin.prototype._detachBinding = function (oBinding) {
        oBinding.detachChange(this._onBindingChange, this);
    };

    /**
     * Handles binding change events (sort, filter, refresh, etc.)
     * Unlike standard plugins, we do NOT clear selection on sort/filter.
     * We re-fire the selectionChange event with updated indices after
     * the binding update so consumers stay in sync.
     */
    PersistSelectionPlugin.prototype._onBindingChange = function (oEvent) {
        const sReason = oEvent.getParameter("reason");
        if (sReason === "sort" || sReason === "filter") {
            // Selection paths are still valid — just notify with updated indices
            // Small delay to let the table rows re-render with new binding data
            setTimeout(function () {
                if (this._oSelectedPaths.size > 0) {
                    this._fireSelectionChange("sortFilter");
                }
            }.bind(this), 0);
        }
    };

    // ─── Range selection helper ───────────────────────────────────────────────

    PersistSelectionPlugin.prototype._selectRange = function (oEndRow, bSelected) {
        const oTable = this.getControl();
        if (!oTable) {
            return;
        }

        const iEndIndex = oEndRow.getIndex();
        const aRows = oTable.getRows();

        // Find the last selected row index as the range start
        let iStartIndex = iEndIndex;
        let iLastSelectedIndex = -1;
        aRows.forEach(function (oRow) {
            const oContext = oRow.getBindingContext();
            if (oContext && this._oSelectedPaths.has(oContext.getPath())) {
                const idx = oRow.getIndex();
                if (idx < iEndIndex && idx > iLastSelectedIndex) {
                    iLastSelectedIndex = idx;
                    iStartIndex = idx;
                }
            }
        }, this);

        const iFrom = Math.min(iStartIndex, iEndIndex);
        const iTo   = Math.max(iStartIndex, iEndIndex);

        aRows.forEach(function (oRow) {
            const iIdx = oRow.getIndex();
            if (iIdx >= iFrom && iIdx <= iTo) {
                const oContext = oRow.getBindingContext();
                if (oContext) {
                    if (bSelected) {
                        this._oSelectedPaths.add(oContext.getPath());
                    } else {
                        this._oSelectedPaths.delete(oContext.getPath());
                    }
                }
            }
        }, this);

        this._fireSelectionChange("user");
    };

    // ─── Internal helpers ─────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype._fireSelectionChange = function (sTrigger) {
        this.fireSelectionChange({
            contextPaths: this.getSelectedContextPaths(),
            rowIndices:   this.getSelectedIndices(),
            trigger:      sTrigger || "user"
        });
    };

    return PersistSelectionPlugin;
});
