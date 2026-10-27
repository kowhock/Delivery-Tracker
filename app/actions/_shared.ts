// Plain helpers shared by the action files. Kept out of the "use server" files,
// where every export would become an action the browser can call.

export const notYourBranch = (branch: string) => `${branch} branch delivers this DO — only ${branch} can choose its driver or date.`;
