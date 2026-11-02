declare module "*.txt" {
  const content: string;
  export default content;
}

declare module "*.svg" {
  const content: string;
  export default content;
}

declare module "*.css";

declare module "*.png" {
  const url: string;
  export default url;
}
