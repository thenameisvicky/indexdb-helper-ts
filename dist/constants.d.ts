export declare const DB_ACTIONS: {
    READ: string;
    WRITE: string;
    UPDATE: string;
    DELETE: string;
    CLEAR: string;
};
export type DbActionTypes = keyof typeof DB_ACTIONS;
