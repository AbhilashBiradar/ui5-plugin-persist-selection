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
    "sap/ui/table/utils/TableUtils",
    "sap/base/Log"
], function (SelectionPlugin, TableUtils, Log) {
    "use strict";

    const LOGGER = "com.abhilashbiradar.PersistSelectionPlugin";

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
     * NOTE: Context-path-based persistence works reliably with OData models where
     * paths are entity-key-based (e.g. /Products(1)). For JSON models, paths are
     * index-based (/Products/0) and will shift after filter — a warning is logged
     * and the plugin falls back to index-based behaviour in that case.
     *
     * @extends sap.ui.table.plugins.SelectionPlugin
     * @since UI5 1.64.0
     *
     * @example
     *   // Attach to table (preferred since UI5 1.120):
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
                     * Selection mode. MultiToggle or Single.
                     * @type {sap.ui.table.SelectionMode}
                     */
                    selectionMode: {
                        type: "sap.ui.table.SelectionMode",
                        defaultValue: "MultiToggle"
                    },
                    /**
                     * Maximum number of rows that can be selected simultaneously.
                     * 0 = unlimited.
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
                     *
                     * @param {string[]} contextPaths - Binding context paths of selected rows.
                     *   Stable across sort/filter for OData models.
                     * @param {int[]} rowIndices - Current visible row indices of selected rows.
                     *   Only includes rows visible in the current scroll position.
                     * @param {string} trigger - "user" | "sortFilter" | "programmatic"
                     * @param {boolean} limitReached - true if selection was blocked by the limit
                     */
                    selectionChange: {
                        parameters: {
                            contextPaths: { type: "string[]" },
                            rowIndices:   { type: "int[]" },
                            trigger:      { type: "string" },
                            limitReached: { type: "boolean" }
                        }
                    }
                }
            }
        }
    );

    // Allow consumers to find the plugin on a table:
    // PersistSelectionPlugin.findOn(oTable)
    PersistSelectionPlugin.findOn = SelectionPlugin.findOn;

    // ─── Lifecycle ────────────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype.init = function () {
        SelectionPlugin.prototype.init.apply(this, arguments);
        // Set of binding context paths currently selected.
        // Using paths (not indices) keeps selections valid after sort/filter.
        this._oSelectedPaths = new Set();
        // Whether a sort/filter is pending — used to re-fire selectionChange
        // after rows actually update (via UpdateRows hook, not setTimeout).
        this._bPendingSortFilterNotify = false;
        // Whether the bound model is JSON — if so warn about limitations.
        this._bIsJsonModel = false;
    };

    PersistSelectionPlugin.prototype.onActivate = function (oTable) {
        SelectionPlugin.prototype.onActivate.apply(this, arguments);

        oTable.setProperty("selectionMode", this.getSelectionMode());

        // RowsBound: fired after binding object is created (table re-bound)
        TableUtils.Hook.register(
            oTable,
            TableUtils.Hook.Keys.Table.RowsBound,
            this._onRowsBound,
            this
        );

        // RowsUnbound: fired when rows are unbound (not caused by rebind/destroy)
        TableUtils.Hook.register(
            oTable,
            TableUtils.Hook.Keys.Table.RowsUnbound,
            this._onRowsUnbound,
            this
        );

        // UpdateRows: fired after rows have actually re-rendered.
        // Used to re-notify consumers after sort/filter (replaces fragile setTimeout).
        TableUtils.Hook.register(
            oTable,
            TableUtils.Hook.Keys.Table.UpdateRows,
            this._onUpdateRows,
            this
        );

        // Attach to existing binding if table is already bound
        const oBinding = oTable.getBinding("rows");
        if (oBinding) {
            this._attachBinding(oTable, oBinding);
        }
    };

    PersistSelectionPlugin.prototype.onDeactivate = function (oTable) {
        SelectionPlugin.prototype.onDeactivate.apply(this, arguments);

        oTable.setProperty("selectionMode", "None");

        TableUtils.Hook.deregister(
            oTable, TableUtils.Hook.Keys.Table.RowsBound, this._onRowsBound, this
        );
        TableUtils.Hook.deregister(
            oTable, TableUtils.Hook.Keys.Table.RowsUnbound, this._onRowsUnbound, this
        );
        TableUtils.Hook.deregister(
            oTable, TableUtils.Hook.Keys.Table.UpdateRows, this._onUpdateRows, this
        );

        const oBinding = oTable.getBinding("rows");
        if (oBinding) {
            this._detachBinding(oBinding);
        }
    };

    PersistSelectionPlugin.prototype.exit = function () {
        this._oSelectedPaths.clear();
        this._bPendingSortFilterNotify = false;
    };

    // ─── Required abstract method implementations ─────────────────────────────

    /**
     * Called by the table when a row is clicked or keyboard-toggled.
     * @param {sap.ui.table.Row} oRow
     * @param {boolean} bSelected
     * @param {object} [mConfig] - { range: boolean } for shift+click range selection
     */
    PersistSelectionPlugin.prototype.setSelected = function (oRow, bSelected, mConfig) {
        const oContext = oRow.getBindingContext();
        if (!oContext) {
            return;
        }

        const sPath = oContext.getPath();
        let bLimitReached = false;

        if (this.getSelectionMode() === "Single") {
            this._oSelectedPaths.clear();
            if (bSelected) {
                this._oSelectedPaths.add(sPath);
            }
        } else if (mConfig && mConfig.range) {
            this._selectRange(oRow, bSelected);
            return; // _selectRange fires the event itself
        } else {
            if (bSelected) {
                const iLimit = this.getLimit();
                if (iLimit > 0 && this._oSelectedPaths.size >= iLimit) {
                    bLimitReached = true;
                } else {
                    this._oSelectedPaths.add(sPath);
                }
            } else {
                this._oSelectedPaths.delete(sPath);
            }
        }

        this._fireSelectionChange("user", bLimitReached);
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
     * Returns the number of selected rows. Used for drag ghost rendering.
     * @returns {int}
     */
    PersistSelectionPlugin.prototype.getSelectedCount = function () {
        return this._oSelectedPaths.size;
    };

    // ─── Header selector ──────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype.handleHeaderSelectorPress = function () {
        if (this._oSelectedPaths.size > 0) {
            this.clearSelection();
        } else {
            return this.selectAll();
        }
        return Promise.resolve();
    };

    PersistSelectionPlugin.prototype.handleKeyboardShortcut = function (sType) {
        if (sType === "toggle") {
            return this.handleHeaderSelectorPress();
        }
        if (sType === "clear") {
            this.clearSelection();
        }
        return Promise.resolve();
    };

    // ─── Public selection API ─────────────────────────────────────────────────

    /**
     * Returns the binding context paths of all selected rows.
     * Stable across sort and filter for OData models.
     * @returns {string[]}
     */
    PersistSelectionPlugin.prototype.getSelectedContextPaths = function () {
        return Array.from(this._oSelectedPaths);
    };

    /**
     * Returns the current row indices of selected rows that are currently visible.
     * These indices change after sort/filter — use getSelectedContextPaths() for
     * a stable reference.
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
     * Replaces the current selection.
     * @param {string|string[]} vPaths
     */
    PersistSelectionPlugin.prototype.setSelectedContextPaths = function (vPaths) {
        const aPaths = Array.isArray(vPaths) ? vPaths : [vPaths];
        this._oSelectedPaths.clear();
        aPaths.forEach(function (sPath) {
            this._oSelectedPaths.add(sPath);
        }, this);
        this._fireSelectionChange("programmatic", false);
    };

    /**
     * Clears all selections.
     */
    PersistSelectionPlugin.prototype.clearSelection = function () {
        if (this._oSelectedPaths.size === 0) {
            return;
        }
        this._oSelectedPaths.clear();
        this._fireSelectionChange("programmatic", false);
    };

    /**
     * Selects all rows in the binding — not just visible rows.
     * Uses TableUtils.loadContexts to fetch all contexts asynchronously,
     * so this works correctly for large OData datasets.
     * @returns {Promise<void>}
     */
    PersistSelectionPlugin.prototype.selectAll = function () {
        if (this.getSelectionMode() === "Single") {
            return Promise.resolve();
        }

        const oTable = this.getControl();
        if (!oTable) {
            return Promise.resolve();
        }

        const oBinding = oTable.getBinding("rows");
        if (!oBinding) {
            return Promise.resolve();
        }

        const iTotalCount = oBinding.getLength ? oBinding.getLength() : 0;
        if (iTotalCount === 0) {
            return Promise.resolve();
        }

        // Use TableUtils.loadContexts to fetch ALL contexts — not just visible rows.
        // This is the same approach used internally by MultiSelectionPlugin.
        return TableUtils.loadContexts(oTable, 0, iTotalCount, false)
            .then(function (aContexts) {
                if (!aContexts) {
                    return;
                }
                const iLimit = this.getLimit();
                let bLimitReached = false;
                aContexts.forEach(function (oContext, i) {
                    if (!oContext) {
                        return;
                    }
                    if (iLimit > 0 && i >= iLimit) {
                        bLimitReached = true;
                        return;
                    }
                    this._oSelectedPaths.add(oContext.getPath());
                }, this);
                this._fireSelectionChange("programmatic", bLimitReached);
            }.bind(this));
    };

    // ─── Hook handlers ────────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype._onRowsBound = function (oBinding) {
        const oTable = this.getControl();
        this._attachBinding(oTable, oBinding);
    };

    PersistSelectionPlugin.prototype._onRowsUnbound = function () {
        const oTable = this.getControl();
        const oBinding = oTable && oTable.getBinding("rows");
        if (oBinding) {
            this._detachBinding(oBinding);
        }
    };

    /**
     * Fired by TableUtils after rows have actually re-rendered.
     * This is the correct moment to notify consumers about updated indices
     * after a sort/filter — replaces the fragile setTimeout(0) approach.
     */
    PersistSelectionPlugin.prototype._onUpdateRows = function () {
        if (this._bPendingSortFilterNotify && this._oSelectedPaths.size > 0) {
            this._bPendingSortFilterNotify = false;
            this._fireSelectionChange("sortFilter", false);
        }
    };

    // ─── Binding attachment ───────────────────────────────────────────────────

    PersistSelectionPlugin.prototype._attachBinding = function (oTable, oBinding) {
        // Detect JSON model and warn — context paths are index-based for JSON
        // so persistence across filter is limited.
        const oModel = oTable.getModel(oTable.getBindingInfo("rows")?.model);
        if (oModel?.isA?.("sap.ui.model.json.JSONModel")) {
            this._bIsJsonModel = true;
            Log.warning(
                "PersistSelectionPlugin: JSONModel detected. Context paths for JSON models " +
                "are index-based (/array/0, /array/1) and shift after filter. " +
                "Selection persistence across filter is not guaranteed. " +
                "Use an OData model for full persistence support.",
                null,
                LOGGER
            );
        } else {
            this._bIsJsonModel = false;
        }

        oBinding.attachChange(this._onBindingChange, this);
    };

    PersistSelectionPlugin.prototype._detachBinding = function (oBinding) {
        oBinding.detachChange(this._onBindingChange, this);
    };

    /**
     * Handles binding change events.
     * On sort/filter: does NOT clear selection (unlike standard plugins).
     * Sets a flag so _onUpdateRows fires selectionChange after re-render.
     */
    PersistSelectionPlugin.prototype._onBindingChange = function (oEvent) {
        const sReason = oEvent.getParameter("reason");
        if (sReason === "sort" || sReason === "filter") {
            if (this._oSelectedPaths.size > 0) {
                // Mark pending — the actual notification fires in _onUpdateRows
                // once the table has re-rendered with the new binding data.
                // This is more reliable than setTimeout(0).
                this._bPendingSortFilterNotify = true;
            }
        }
    };

    // ─── Range selection ──────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype._selectRange = function (oEndRow, bSelected) {
        const oTable = this.getControl();
        if (!oTable) {
            return;
        }

        const iEndIndex = oEndRow.getIndex();
        const aRows = oTable.getRows();

        // Find the anchor: the closest already-selected row before the end row
        let iAnchorIndex = iEndIndex;
        let iClosestSelectedIndex = -1;
        aRows.forEach(function (oRow) {
            const oContext = oRow.getBindingContext();
            if (oContext && this._oSelectedPaths.has(oContext.getPath())) {
                const idx = oRow.getIndex();
                if (idx !== iEndIndex && idx > iClosestSelectedIndex) {
                    iClosestSelectedIndex = idx;
                    iAnchorIndex = idx;
                }
            }
        }, this);

        const iFrom = Math.min(iAnchorIndex, iEndIndex);
        const iTo   = Math.max(iAnchorIndex, iEndIndex);
        const iLimit = this.getLimit();
        let bLimitReached = false;

        aRows.forEach(function (oRow) {
            const iIdx = oRow.getIndex();
            if (iIdx >= iFrom && iIdx <= iTo) {
                const oContext = oRow.getBindingContext();
                if (oContext) {
                    if (bSelected) {
                        if (iLimit > 0 && this._oSelectedPaths.size >= iLimit) {
                            bLimitReached = true;
                            return;
                        }
                        this._oSelectedPaths.add(oContext.getPath());
                    } else {
                        this._oSelectedPaths.delete(oContext.getPath());
                    }
                }
            }
        }, this);

        this._fireSelectionChange("user", bLimitReached);
    };

    // ─── Internal helpers ─────────────────────────────────────────────────────

    PersistSelectionPlugin.prototype._fireSelectionChange = function (sTrigger, bLimitReached) {
        this.fireSelectionChange({
            contextPaths: this.getSelectedContextPaths(),
            rowIndices:   this.getSelectedIndices(),
            trigger:      sTrigger || "user",
            limitReached: !!bLimitReached
        });
    };

    return PersistSelectionPlugin;
});
