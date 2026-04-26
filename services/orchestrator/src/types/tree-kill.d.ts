declare module "tree-kill" {
  type Signal = string | number;
  function treeKill(pid: number, signal?: Signal, callback?: (err?: Error) => void): void;
  export default treeKill;
}
