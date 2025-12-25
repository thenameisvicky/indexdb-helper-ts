import { expect } from "chai";
import { DbAction } from "../src/DbAction";
import { DB_ACTIONS } from "../src/constants";

describe("DbAction - Real IndexedDB Tests", function () {
  let db: IDBDatabase;
  const DB_NAME = "TestDB";
  const STORE_NAME = "users";
  const DB_VERSION = 1;

  function openTestDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: "id" });
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  function deleteTestDB(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  before(async () => {
    db = await openTestDB();
  });

  after(async () => {
    db.close();
    await deleteTestDB();
  });

  it("should write a document", async () => {
    const action = new DbAction(DB_ACTIONS.WRITE, db, STORE_NAME);
    await action.setDocumentData({ id: "1", name: "Alice" }).execute();
  });

  it("should read a document", async () => {
    const action = new DbAction<{ id: string; name: string }[], any>(
      DB_ACTIONS.READ,
      db,
      STORE_NAME
    );
    const result = await action.execute();
    expect(result).to.deep.include({ id: "1", name: "Alice" });
  });

  it("should update a document", async () => {
    const action = new DbAction<any, { id: string; name: string }>(
      DB_ACTIONS.UPDATE,
      db,
      STORE_NAME
    );
    await action.setDocumentData({ id: "1", name: "Alice Updated" }).execute();

    const readAction = new DbAction<{ id: string; name: string }[], any>(
      DB_ACTIONS.READ,
      db,
      STORE_NAME
    );
    const result = await readAction.execute();
    expect(result).to.deep.include({ id: "1", name: "Alice Updated" });
  });

  it("should delete a document", async () => {
    const action = new DbAction<any, any>(DB_ACTIONS.DELETE, db, STORE_NAME);
    await action.setDeleteKey("1").execute();

    const readAction = new DbAction<{ id: string; name: string }[], any>(
      DB_ACTIONS.READ,
      db,
      STORE_NAME
    );
    const result = await readAction.execute();
    expect(result).to.not.deep.include({ id: "1", name: "Alice Updated" });
  });

  it("should clear the store", async () => {
    const writeAction = new DbAction(DB_ACTIONS.WRITE, db, STORE_NAME);
    await writeAction.setDocumentData({ id: "2", name: "Bob" }).execute();
    await writeAction.setDocumentData({ id: "3", name: "Charlie" }).execute();

    const clearAction = new DbAction(DB_ACTIONS.CLEAR, db, STORE_NAME);
    await clearAction.execute();

    const readAction = new DbAction<{ id: string; name: string }[], any>(
      DB_ACTIONS.READ,
      db,
      STORE_NAME
    );
    const result = await readAction.execute();
    expect(result).to.deep.equal([]);
  });
});
