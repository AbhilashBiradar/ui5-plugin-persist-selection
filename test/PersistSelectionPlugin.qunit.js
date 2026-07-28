
function mockRow(sPath, iIndex) {
    return {
        getBindingContext: function () { return { getPath: function () { return sPath; } }; },
        getIndex: function () { return iIndex; }
    };
}

sap.ui.define("test/PersistSelectionPlugin.qunit", [
    "plugin/PersistSelectionPlugin",
    "sap/ui/table/Table",
    "sap/ui/table/Column",
    "sap/ui/model/json/JSONModel",
    "sap/ui/thirdparty/qunit-2"
], function (
    PersistSelectionPlugin,
    Table,
    Column,
    JSONModel
) {
    "use strict";

    /* eslint-disable no-undef */
    const QUnit = window.QUnit;

    function createTableWithPlugin(mPluginSettings) {
        const oPlugin = new PersistSelectionPlugin(mPluginSettings || {});

        const oTable = new Table({
            visibleRowCount: 5,
            dependents: [oPlugin]
        });

        oTable.addColumn(new Column({ label: "Name", template: new sap.m.Text({ text: "{name}" }) }));
        oTable.addColumn(new Column({ label: "Age",  template: new sap.m.Text({ text: "{age}" }) }));

        const oModel = new JSONModel({
            items: [
                { name: "Alice",   age: 30 },
                { name: "Bob",     age: 25 },
                { name: "Charlie", age: 35 },
                { name: "Diana",   age: 28 },
                { name: "Eve",     age: 22 }
            ]
        });

        oTable.setModel(oModel);
        oTable.bindRows("/items");
        oTable.placeAt("qunit-fixture");
        sap.ui.getCore().applyChanges();

        return { oTable, oPlugin };
    }

    // ─── Module: Core selection logic ─────────────────────────────────────────

    QUnit.module("Core selection logic", {
        beforeEach: function () {
            const result = createTableWithPlugin();
            this.oTable  = result.oTable;
            this.oPlugin = result.oPlugin;
        },
        afterEach: function () {
            this.oTable.destroy();
        }
    });

    QUnit.test("Plugin is active after addDependent", function (assert) {
        assert.ok(this.oPlugin.isActive(), "Plugin should be active");
    });

    QUnit.test("setSelected adds context path to selection", function (assert) {
        const oRow = mockRow("/items/0", 0);
        this.oPlugin.setSelected(oRow, true);

        assert.ok(this.oPlugin.isSelected(oRow), "Row should be selected");
        assert.strictEqual(this.oPlugin.getSelectedCount(), 1, "Count should be 1");
        assert.deepEqual(this.oPlugin.getSelectedContextPaths(), ["/items/0"]);
    });

    QUnit.test("setSelected removes context path on deselect", function (assert) {
        const oRow = mockRow("/items/0", 0);
        this.oPlugin.setSelected(oRow, true);
        this.oPlugin.setSelected(oRow, false);

        assert.notOk(this.oPlugin.isSelected(oRow), "Row should not be selected");
        assert.strictEqual(this.oPlugin.getSelectedCount(), 0);
    });

    QUnit.test("Multiple rows can be selected in MultiToggle mode", function (assert) {
        const oRow0 = mockRow("/items/0", 0);
        const oRow1 = mockRow("/items/1", 1);
        const oRow2 = mockRow("/items/2", 2);

        this.oPlugin.setSelected(oRow0, true);
        this.oPlugin.setSelected(oRow1, true);
        this.oPlugin.setSelected(oRow2, true);

        assert.strictEqual(this.oPlugin.getSelectedCount(), 3);
        assert.ok(this.oPlugin.isSelected(oRow0));
        assert.ok(this.oPlugin.isSelected(oRow1));
        assert.ok(this.oPlugin.isSelected(oRow2));
    });

    QUnit.test("clearSelection removes all selected rows", function (assert) {
        const oRow0 = mockRow("/items/0", 0);
        const oRow1 = mockRow("/items/1", 1);

        this.oPlugin.setSelected(oRow0, true);
        this.oPlugin.setSelected(oRow1, true);
        this.oPlugin.clearSelection();

        assert.strictEqual(this.oPlugin.getSelectedCount(), 0);
        assert.notOk(this.oPlugin.isSelected(oRow0));
        assert.notOk(this.oPlugin.isSelected(oRow1));
    });

    QUnit.test("setSelectedContextPaths selects by path", function (assert) {
        this.oPlugin.setSelectedContextPaths(["/items/0", "/items/2"]);

        assert.strictEqual(this.oPlugin.getSelectedCount(), 2);
        assert.ok(this.oPlugin.isSelected(mockRow("/items/0", 0)));
        assert.ok(this.oPlugin.isSelected(mockRow("/items/2", 2)));
        assert.notOk(this.oPlugin.isSelected(mockRow("/items/1", 1)));
    });

    QUnit.test("selectionChange event fires on setSelected", function (assert) {
        assert.expect(3);
        this.oPlugin.attachSelectionChange(function (oEvent) {
            assert.strictEqual(oEvent.getParameter("trigger"), "user");
            assert.deepEqual(oEvent.getParameter("contextPaths"), ["/items/0"]);
            assert.notOk(oEvent.getParameter("limitReached"));
        });
        this.oPlugin.setSelected(mockRow("/items/0", 0), true);
    });

    QUnit.test("selectionChange event fires on clearSelection", function (assert) {
        assert.expect(1);
        this.oPlugin.setSelected(mockRow("/items/0", 0), true);
        this.oPlugin.attachSelectionChange(function (oEvent) {
            assert.strictEqual(oEvent.getParameter("trigger"), "programmatic");
        });
        this.oPlugin.clearSelection();
    });

    // ─── Module: Single selection mode ────────────────────────────────────────

    QUnit.module("Single selection mode", {
        beforeEach: function () {
            const result = createTableWithPlugin({ selectionMode: "Single" });
            this.oTable  = result.oTable;
            this.oPlugin = result.oPlugin;
        },
        afterEach: function () {
            this.oTable.destroy();
        }
    });

    QUnit.test("Selecting a second row replaces the first", function (assert) {
        const oRow0 = mockRow("/items/0", 0);
        const oRow1 = mockRow("/items/1", 1);

        this.oPlugin.setSelected(oRow0, true);
        this.oPlugin.setSelected(oRow1, true);

        assert.strictEqual(this.oPlugin.getSelectedCount(), 1, "Only 1 row selected");
        assert.notOk(this.oPlugin.isSelected(oRow0), "Row 0 should be deselected");
        assert.ok(this.oPlugin.isSelected(oRow1), "Row 1 should be selected");
    });

    // ─── Module: Selection limit ──────────────────────────────────────────────

    QUnit.module("Selection limit", {
        beforeEach: function () {
            const result = createTableWithPlugin({ limit: 2 });
            this.oTable  = result.oTable;
            this.oPlugin = result.oPlugin;
        },
        afterEach: function () {
            this.oTable.destroy();
        }
    });

    QUnit.test("Cannot select more rows than the limit", function (assert) {
        this.oPlugin.setSelected(mockRow("/items/0", 0), true);
        this.oPlugin.setSelected(mockRow("/items/1", 1), true);
        this.oPlugin.setSelected(mockRow("/items/2", 2), true); // should be blocked

        assert.strictEqual(this.oPlugin.getSelectedCount(), 2, "Only 2 rows selected");
        assert.notOk(this.oPlugin.isSelected(mockRow("/items/2", 2)));
    });

    QUnit.test("limitReached parameter is true when limit is hit", function (assert) {
        assert.expect(1);
        this.oPlugin.setSelected(mockRow("/items/0", 0), true);
        this.oPlugin.setSelected(mockRow("/items/1", 1), true);

        this.oPlugin.attachSelectionChange(function (oEvent) {
            assert.ok(oEvent.getParameter("limitReached"), "limitReached should be true");
        });
        this.oPlugin.setSelected(mockRow("/items/2", 2), true);
    });

    // ─── Module: Selection persistence across context path change ─────────────

    QUnit.module("Selection persistence — context path stability", {
        beforeEach: function () {
            const result = createTableWithPlugin();
            this.oTable  = result.oTable;
            this.oPlugin = result.oPlugin;
        },
        afterEach: function () {
            this.oTable.destroy();
        }
    });

    QUnit.test("Selection survives path re-lookup after sorting (simulated)", function (assert) {
        // Simulate: row at /items/2 is selected before sort.
        // After sort the same entity is now at a different visual position
        // but the path /items/2 still refers to the same object in a JSON model.
        // The plugin should still report it as selected.
        const oRowBeforeSort = mockRow("/items/2", 2);
        this.oPlugin.setSelected(oRowBeforeSort, true);

        // Simulate post-sort: same path, different visual index
        const oRowAfterSort = mockRow("/items/2", 0);
        assert.ok(this.oPlugin.isSelected(oRowAfterSort),
            "Row with same context path should remain selected after sort");
    });

    QUnit.test("setSelectedContextPaths persists across re-rendered rows", function (assert) {
        this.oPlugin.setSelectedContextPaths(["/items/1", "/items/3"]);

        // Simulate rows re-rendering at different indices (e.g. after scroll)
        assert.ok(this.oPlugin.isSelected(mockRow("/items/1", 4)));
        assert.ok(this.oPlugin.isSelected(mockRow("/items/3", 0)));
        assert.notOk(this.oPlugin.isSelected(mockRow("/items/0", 0)));
    });

    QUnit.test("findOn returns the plugin instance from a table", function (assert) {
        const oFound = PersistSelectionPlugin.findOn(this.oTable);
        assert.strictEqual(oFound, this.oPlugin, "findOn should return the attached plugin");
    });

    // ─── Module: isSelected edge cases ────────────────────────────────────────

    QUnit.module("isSelected edge cases");

    QUnit.test("isSelected returns false for row without binding context", function (assert) {
        const oPlugin = new PersistSelectionPlugin();
        const oRow = { getBindingContext: function () { return null; } };
        assert.notOk(oPlugin.isSelected(oRow));
        oPlugin.destroy();
    });

    QUnit.test("getSelectedCount returns 0 initially", function (assert) {
        const oPlugin = new PersistSelectionPlugin();
        assert.strictEqual(oPlugin.getSelectedCount(), 0);
        oPlugin.destroy();
    });

    QUnit.test("clearSelection does not fire event when already empty", function (assert) {
        assert.expect(0); // event should NOT fire
        const oPlugin = new PersistSelectionPlugin();
        oPlugin.attachSelectionChange(function () {
            assert.ok(false, "should not fire");
        });
        oPlugin.clearSelection();
        oPlugin.destroy();
    });
});
