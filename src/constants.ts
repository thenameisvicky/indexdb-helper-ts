export const DB_ACTIONS = {
  READ: "READ",
  WRITE: "WRITE",
  UPDATE: "UPDATE",
  DELETE: "DELETE",
  CLEAR: "CLEAR",
};

export type DbActionTypes = keyof typeof DB_ACTIONS;