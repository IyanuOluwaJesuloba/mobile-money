import * as fs from "fs";
import * as path from "path";
import * as yaml from "js-yaml";

describe("Stale Branch Cleanup workflow", () => {
  const workflowPath = path.join(
    process.cwd(),
    ".github",
    "workflows",
    "stale-branch-cleanup.yml",
  );

  let workflow: any;

  beforeAll(() => {
    const content = fs.readFileSync(workflowPath, "utf8");
    workflow = yaml.load(content);
  });

  it("should exist and parse as YAML", () => {
    expect(fs.existsSync(workflowPath)).toBe(true);
    expect(workflow).toBeDefined();
    expect(typeof workflow).toBe("object");
  });

  it("should define scheduled and manual triggers", () => {
    expect(workflow.on).toBeDefined();
    expect(workflow.on.schedule).toBeDefined();
    expect(Array.isArray(workflow.on.schedule)).toBe(true);
    expect(workflow.on.schedule[0].cron).toBeDefined();
    expect(workflow.on.workflow_dispatch).toBeDefined();
  });

  it("should request write permissions for contents and issues", () => {
    expect(workflow.permissions).toBeDefined();
    expect(workflow.permissions.contents).toBe("write");
    expect(workflow.permissions.issues).toBe("write");
    expect(workflow.permissions["pull-requests"]).toBe("read");
  });

  it("should expose expected workflow_dispatch inputs", () => {
    const inputs = workflow.on.workflow_dispatch.inputs;
    expect(inputs).toBeDefined();
    expect(inputs.stale_days).toBeDefined();
    expect(inputs.stale_days.default).toBe("30");
    expect(inputs.delete_after_days).toBeDefined();
    expect(inputs.delete_after_days.default).toBe("7");
    expect(inputs.dry_run).toBeDefined();
    expect(inputs.dry_run.default).toBe("true");
  });

  it("should use actions/github-script for cleanup logic", () => {
    const job = workflow.jobs["stale-branch-cleanup"];
    expect(job).toBeDefined();
    const githubScriptStep = job.steps.find(
      (step: any) => step.uses && step.uses.includes("actions/github-script"),
    );
    expect(githubScriptStep).toBeDefined();
    expect(githubScriptStep.with.script).toContain("stale-branch-cleanup");
    expect(githubScriptStep.with.script).toContain("deleteRef");
  });
});
