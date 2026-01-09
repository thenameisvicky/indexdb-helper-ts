import { DB_ACTIONS } from "./constants";
/**
 * IndexedDB Action Executor
 *
 * A low-level, type-safe abstraction over IndexedDB operations that provides
 * explicit control over transactions, durability guarantees, and access patterns.
 *
 * Design Philosophy:
 * This abstraction intentionally mirrors IndexedDB semantics rather than
 * hiding them behind ORM-style APIs. This approach provides:
 * - Predictable behavior aligned with browser IndexedDB specification
 * - Explicit transaction management with configurable durability
 * - Zero hidden caching or identity maps that could cause stale data
 * - Direct access to IndexedDB primitives (stores, indexes, key ranges)
 *
 * Non-Goals:
 * - Schema validation (handled at application layer)
 * - Partial updates (full document replacement only)
 * - Query abstraction (use IndexedDB cursors directly)
 *
 * Type Safety:
 * Consumers must provide explicit input and output types via generics to
 * ensure compile-time type checking and prevent type-related runtime errors.
 *
 * @template TRead - The type of data returned from read operations
 * @template TWrite - The type of data accepted for write operations
 *
 * @example
 * ```typescript
 * interface User { id: string; name: string; }
 * const action = new DbAction<User[], User>(
 *   DB_ACTIONS.READ,
 *   database,
 *   'users'
 * );
 * const users = await action.execute(); // Type: User[]
 * ```
 */
export class DbAction {
    /**
     * The database operation to execute.
     * Must be one of the predefined DB_ACTIONS constants.
     */
    action;
    /**
     * The IndexedDB database instance.
     * Provided by the consumer to maintain explicit control over database lifecycle.
     */
    databaseInstance;
    /**
     * The object store name within the database.
     * Must correspond to an existing object store in the database schema.
     */
    storeName;
    /**
     * Index hint for read operations.
     * When specified, directs the operation to use a specific index for optimized access.
     * The index must exist on the target object store.
     */
    hintIndex;
    /**
     * Transaction durability setting.
     * Controls the durability guarantee of the transaction:
     * - "strict": Data must be written to disk before transaction completes
     * - "relaxed": Allows optimizations that may defer disk writes (default)
     *
     * @default "relaxed"
     */
    durability = "relaxed";
    /**
     * Document data for write and update operations.
     * Must conform to the TWrite type constraint.
     */
    updateDoc;
    /**
     * Key or key range for delete operations.
     * Can be a single valid key or an IDBKeyRange for bulk deletions.
     */
    deleteDoc;
    /**
     * Constructs a new database action instance.
     *
     * @param action
     * @param databaseInstance
     * @param storeName
     *
     * @throws {TypeError}
     */
    constructor(action, databaseInstance, storeName) {
        if (!(databaseInstance instanceof IDBDatabase)) {
            throw new TypeError("databaseInstance must be a valid IDBDatabase instance");
        }
        if (typeof storeName !== "string" || storeName.length === 0) {
            throw new TypeError("storeName must be a non-empty string");
        }
        this.action = action;
        this.databaseInstance = databaseInstance;
        this.storeName = storeName;
    }
    /**
     * Configures the action to use a specific index for read operations.
     *
     * Index hints allow consumers to optimize read operations by directing
     * IndexedDB to use a specific index. This is particularly useful for:
     * - Range queries on indexed fields
     * - Sorted retrieval operations
     * - Performance optimization when multiple indexes exist
     *
     * @public
     *
     * @param indexName
     * @returns {this}
     *
     * @throws {TypeError}
     */
    configureIndexHint(indexName) {
        if (typeof indexName !== "string" || indexName.length === 0) {
            throw new TypeError("indexName must be a non-empty string");
        }
        this.hintIndex = indexName;
        return this;
    }
    /**
     * Configures the transaction durability setting.
     *
     * Durability controls the guarantee that data will persist to disk:
     * - "strict": Ensures data is written to disk before transaction completes.
     *   Use when data integrity is critical (e.g., financial transactions).
     * - "relaxed": Allows optimizations that may defer disk writes.
     *   Use for better performance when immediate persistence is not required.
     *
     * @public
     *
     * @param durability
     * @returns {this}
     *
     * @throws {TypeError}
     */
    configureDurability(durability) {
        if (durability !== "strict" && durability !== "relaxed") {
            throw new TypeError('durability must be either "strict" or "relaxed"');
        }
        this.durability = durability;
        return this;
    }
    /**
     * Sets the document data for write and update operations.
     *
     * The provided document must conform to the TWrite type constraint.
     * For write operations, this is the document to insert.
     * For update operations, this is the partial document to merge with existing data.
     *
     * @public
     *
     * @param updateDoc
     * @returns {this}
     *
     */
    setDocumentData(updateDoc) {
        this.updateDoc = updateDoc;
        return this;
    }
    /**
     * Sets the key or key range for delete operations.
     *
     * @public
     *
     * @param deleteKey
     * @returns {this}
     *
     */
    setDeleteKey(deleteKey) {
        this.deleteDoc = deleteKey;
        return this;
    }
    /**
     * Resolves the appropriate store or index for the operation.
     *
     * This method encapsulates the logic for:
     * - Creating transactions with the configured durability
     * - Selecting the appropriate object store
     * - Optionally resolving to an index when a hint is provided (READ operations only)
     *
     * The returned store/index is bound to a transaction that will be
     * automatically committed or rolled back based on operation success.
     *
     * Note: Index hints apply only to READ operations. Write operations (WRITE, UPDATE,
     * DELETE, CLEAR) must always use the object store directly as indexes are read-only in IndexedDB.
     *
     * @private
     *
     * @param transactionMode
     * @param allowIndex
     * @returns {IDBObjectStore | IDBIndex}
     *
     */
    resolveStoreOrIndex(transactionMode = "readonly", allowIndex = false) {
        const transaction = this.databaseInstance.transaction([this.storeName], transactionMode, {
            durability: this.durability,
        });
        const objectStore = transaction.objectStore(this.storeName);
        if (allowIndex &&
            this.hintIndex &&
            objectStore.indexNames.contains(this.hintIndex)) {
            return { source: objectStore.index(this.hintIndex), tranx: transaction };
        }
        return { source: objectStore, tranx: transaction };
    }
    /**
     * Executes a read operation to retrieve all records from the store.
     *
     * This operation:
     * - Uses a readonly transaction for optimal performance
     * - Respects index hints when configured
     * - Returns all records matching the store/index configuration
     *
     * @private
     *
     * @returns {Promise<TRead[]>}
     */
    async executeRead() {
        const { source: store, tranx: transaction } = this.resolveStoreOrIndex("readonly", true);
        const request = store.getAll();
        return new Promise((resolve, reject) => {
            let result;
            request.onsuccess = () => {
                result = request.result;
            };
            request.onerror = () => {
                reject(request.error || new Error("Read operation failed with unknown error"));
            };
            transaction.oncomplete = () => {
                if (result !== undefined) {
                    resolve(result);
                }
                else {
                    reject(new Error("Read operation completed without result"));
                }
            };
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    /**
     * Executes a write operation to insert a new record.
     *
     * This operation:
     * - Uses a readwrite transaction
     * - Inserts the document provided via setDocumentData()
     * - Fails if a record with the same key already exists (unless upsert is enabled)
     *
     * @private
     *
     * @returns {Promise<void>}
     *
     * @throws {Error}
     * @throws {DOMException}
     */
    async executeWrite() {
        if (this.updateDoc === undefined) {
            throw new Error("Document data is required for write operations");
        }
        const { source: store, tranx: transaction } = this.resolveStoreOrIndex("readwrite", false);
        if (!(store instanceof IDBObjectStore)) {
            throw new Error("Write operations require an IDBObjectStore, not an IDBIndex");
        }
        const request = store.add(this.updateDoc);
        return new Promise((resolve, reject) => {
            request.onerror = () => reject(request.error || new Error("Write operation failed"));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    /**
     * Executes an update operation to modify an existing record.
     *
     * This operation:
     * - Uses a readwrite transaction
     * - Requires the primary key to be present in updateDoc
     * - Resolves the primary key from objectStore.keyPath
     * - Performs a direct put operation (full document replacement)
     *
     * Update semantics:
     * - The primary key MUST be present inside updateDoc
     * - The keyPath MUST be a string (array keyPaths not supported)
     * - Updates always target the object store (indexes are read-only)
     * - No existing record is read; put() performs upsert semantics
     *
     * @private
     *
     * @returns {Promise<void>}
     *
     * @throws {Error}
     * @throws {Error}
     * @throws {Error}
     * @throws {DOMException}
     */
    async executeUpdate() {
        if (this.updateDoc === undefined) {
            throw new Error("Document data is required for update operations");
        }
        const { source: store, tranx: transaction } = this.resolveStoreOrIndex("readwrite", false);
        if (store instanceof IDBIndex) {
            throw new Error("Update operations require an IDBObjectStore, not an IDBIndex");
        }
        const keyPath = store.keyPath;
        if (keyPath === null) {
            throw new Error("Update operations require a keyPath. Object store must have an inline key.");
        }
        if (typeof keyPath !== "string") {
            throw new Error("Update operations require a string keyPath. Array-based keyPaths are not supported.");
        }
        const updateDocObj = this.updateDoc;
        if (!(keyPath in updateDocObj) || updateDocObj[keyPath] === undefined) {
            throw new Error(`Update document must contain the primary key '${keyPath}'. ` +
                `The key is required to identify the record to update.`);
        }
        const request = store.put(this.updateDoc);
        return new Promise((resolve, reject) => {
            request.onerror = () => {
                reject(request.error ||
                    new Error("Update operation failed with unknown error"));
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    /**
     * Executes a delete operation to remove a record or range of records.
     *
     * This operation:
     * - Uses a readwrite transaction
     * - Deletes the record(s) matching the provided key or key range
     * - Supports both single-key and bulk deletions via IDBKeyRange
     * - Always targets the object store (indexes are read-only)
     *
     * @private
     *
     * @returns {Promise<void>}
     *
     * @throws {Error}
     * @throws {DOMException}
     */
    async executeDelete() {
        if (this.deleteDoc === undefined) {
            throw new Error("Delete key or key range is required for delete operations");
        }
        const { source: store, tranx: transaction } = this.resolveStoreOrIndex("readwrite", false);
        if (!(store instanceof IDBObjectStore)) {
            throw new Error("Delete operations require an IDBObjectStore, not an IDBIndex");
        }
        const request = store.delete(this.deleteDoc);
        return new Promise((resolve, reject) => {
            request.onerror = () => reject(request.error || new Error("Delete operation failed"));
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    /**
     * Executes a clear operation to remove all records from the store.
     *
     * This operation:
     * - Uses a readwrite transaction
     * - Removes all records from the object store
     * - Does not affect the store structure or indexes
     * - Always targets the object store (indexes are read-only)
     *
     * Warning: This operation is irreversible and will delete all data
     * in the specified object store.
     *
     * @private
     *
     * @returns {Promise<void>}
     *
     * @throws {DOMException}
     */
    async executeClear() {
        const { source: store, tranx: transaction } = this.resolveStoreOrIndex("readwrite", false);
        if (!(store instanceof IDBObjectStore)) {
            throw new Error("Clear operations require an IDBObjectStore, not an IDBIndex");
        }
        const request = store.clear();
        return new Promise((resolve, reject) => {
            request.onerror = () => {
                reject(request.error ||
                    new Error("Clear operation failed with unknown error"));
            };
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
            transaction.onabort = () => reject(transaction.error);
        });
    }
    /**
     * Executes the configured database operation.
     *
     * This is the primary public method that dispatches to the appropriate
     * operation handler based on the action type specified during construction.
     *
     * The method implements a strategy pattern, routing to the correct operation
     * handler while maintaining type safety through generics.
     *
     * @public
     *
     * @returns {Promise<TRead[] | void>}
     *
     * @throws {Error}
     * @throws {DOMException}
     *
     * @example
     * ```typescript
     * // Define your data type
     * interface User {
     *   id: string;       // Primary key
     *   name: string;
     *   email?: string;
     * }
     *
     * // Open your IndexedDB instance
     * const database = await indexedDB.open("MyDatabase", 1);
     *
     * // Read all users
     * const readAction = new DbAction<User, User>(
     *   DB_ACTIONS.READ,
     *   database,
     *   "users"
     * );
     * const users: User[] = await readAction.execute();
     *
     * // Insert a new user
     * const writeAction = new DbAction<User, User>(
     *   DB_ACTIONS.WRITE,
     *   database,
     *   "users"
     * );
     * await writeAction.setDocumentData({ id: "123", name: "Alice" }).execute();
     *
     * // Update an existing user
     * const updateAction = new DbAction<User, User>(
     *   DB_ACTIONS.UPDATE,
     *   database,
     *   "users"
     * );
     * await updateAction.setDocumentData({ id: "123", name: "Alice Updated" }).execute();
     *
     * // Delete a user by key
     * const deleteAction = new DbAction<User, User>(
     *   DB_ACTIONS.DELETE,
     *   database,
     *   "users"
     * );
     * await deleteAction.setDeleteKey("123").execute();
     *
     * // Clear all users
     * const clearAction = new DbAction<User, User>(
     *   DB_ACTIONS.CLEAR,
     *   database,
     *   "users"
     * );
     * await clearAction.execute();
     * ```
     *
     * This example shows **how to safely use DbAction** with full type safety.
     * `TRead` is the type returned from READ operations, `TWrite` is the type used for WRITE/UPDATE.
     */
    async execute() {
        switch (this.action) {
            case DB_ACTIONS.READ:
                return this.executeRead();
            case DB_ACTIONS.WRITE:
                return this.executeWrite();
            case DB_ACTIONS.UPDATE:
                return this.executeUpdate();
            case DB_ACTIONS.DELETE:
                return this.executeDelete();
            case DB_ACTIONS.CLEAR:
                return this.executeClear();
            default:
                throw new Error(`Unrecognized database action: ${this.action}. ` +
                    `Must be one of: ${Object.values(DB_ACTIONS).join(", ")}`);
        }
    }
}
