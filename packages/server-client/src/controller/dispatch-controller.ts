import * as assert from "assert";
import { AssertionError } from "assert";
import { cloneDeep, isNil } from "lodash";
import { EHostType, HostCache, IHostCacheValue } from "../cache/host-cache";
import { Project } from "../entity/project";
import { EDeployTargetType, ProjectEnvDeploy } from "../entity/project-env-deploy";
import { ResourceFetchFailedError } from "../error/ResourceFetchFailedError";
import { UnMatchedProjectEnvDeployError } from "../error/UnMatchedProjectEnvDeployError";
import { InvalidPreviewError } from "../error/InvalidPreviewError";
import { UnMatchedHostError } from "../error/UnMatchedHostError";
import { UnMatchedProjectEnvError } from "../error/UnMatchedProjectEnvError";
import { UnMatchedProjectError } from "../error/UnMatchedProjectError";
import { IContext } from "../interface/context";
import { ProjectService } from "../service/project-service";
import { ResourceService } from "../service/resource-service";
import { ctxPrint } from "../util/ctx-print";
import { Logger } from "../util/logger";

export class DispatchController {
  private logger = Logger.create();

  private projectService = new ProjectService();
  private resourceService = new ResourceService();
  private hostCache = HostCache.getInstance();

  async dispatchWithErrorHandler(ctx: IContext): Promise<void> {
    try {
      return await this.dispatch(ctx);
    } catch (err) {
      this.logger.warn(ctxPrint(ctx), `load resource failed: ${err.constructor.name}`);

      if (err instanceof AssertionError) {
        return this.resourceService.response404Buffer(ctx, "AssertionError");
      }

      if (
        err instanceof InvalidPreviewError ||
        err instanceof ResourceFetchFailedError ||
        err instanceof UnMatchedHostError ||
        err instanceof UnMatchedProjectError ||
        err instanceof UnMatchedProjectEnvError ||
        err instanceof UnMatchedProjectEnvDeployError
      ) {
        return this.resourceService.response404Buffer(ctx, err.name);
      }

      this.logger.error(ctxPrint(ctx), `UnknownError: `, err.stack);
      return this.resourceService.response404Buffer(ctx, "UnKnownError");
    }
  }

  async dispatch(ctx: IContext): Promise<void> {
    const reqHost = ctx.req.headers.host;

    const hostCache: IHostCacheValue = this.hostCache.test(reqHost);
    const { hostType, projectName, envName, deployId } = hostCache;

    // ??????????????????
    if (hostType === EHostType.Default) {
      return await this.dispatchDefault(ctx, projectName, envName);
    }

    // ??????????????????
    if (hostType === EHostType.Preview) {
      return await this.dispatchPreview(ctx, +deployId);
    }

    // ?????????????????????
    if (hostType === EHostType.Domain) {
      const { project, env } = await this.projectService.getProjectDomain(reqHost);
      return await this.dispatchDefault(ctx, project.name, env.name);
    }

    // ????????????
    if (hostType === EHostType.Unknown) {
      this.logger.warn(ctxPrint(ctx), `Matched unknown host`);
      throw new UnMatchedHostError(`?????????????????????${reqHost}`);
    }
  }

  /**
   * ????????????????????????
   * ??????????????????????????????????????????????????????
   */
  private async dispatchDefault(ctx: IContext, projectName: string, envName: string) {
    const project = await this.projectService.getProjectByName(projectName);
    assert(!isNil(project), new UnMatchedProjectError(`???????????????????????? ${projectName}`));

    const env = await this.projectService.getProjectEnvByName(project.id, envName);
    assert(!isNil(env), new UnMatchedProjectEnvError(`???????????????????????? ${projectName}-${envName}`));

    const deploy = await this.projectService.getProjectEnvActiveDeploy(env.id);
    assert(!isNil(deploy), new UnMatchedProjectEnvDeployError(`?????????????????????????????? ${projectName}-${envName}`));

    const buffer = await this.getResourceBuffer(ctx, project, deploy);
    assert(!isNil(buffer), new ResourceFetchFailedError(`???????????????????????? ${projectName}-${envName}-${deploy.id}`));

    return this.resourceService.responseSuccessBuffer(ctx, buffer);
  }

  /**
   * ????????????
   */
  private async dispatchPreview(ctx: IContext, deployId: number) {
    const deploy = await this.projectService.getProjectEnvDeployById(deployId);
    assert(!isNil(deploy), new InvalidPreviewError(`?????????????????????????????? ${deployId}`));

    const project = await this.projectService.getProjectById(deploy.projectId);
    assert(!isNil(project), new InvalidPreviewError(`?????????????????????????????? ${project}`));

    const buffer = await this.getResourceBuffer(ctx, project, deploy);
    return this.resourceService.responseSuccessBuffer(ctx, buffer);
  }

  /**
   * ???????????? Buffer
   */
  private async getResourceBuffer(ctx: IContext, project: Project, deploy: ProjectEnvDeploy): Promise<Buffer> {
    const { targetType } = deploy;
    let buffer;

    // ???????????????????????????
    const cache = this.resourceService.getResourceFromLocalCache(ctx);

    // ??????????????????
    if (!isNil(cache)) {
      ctx.respHeaders = cloneDeep(ctx.respHeaders);
      return cache.buffer;
    }

    // ?????????????????????
    if (targetType === EDeployTargetType.Cloud) {
      buffer = await this.resourceService.getResourceBufferFromCloud(ctx, deploy.target);
    }
    if (targetType === EDeployTargetType.Local) {
      throw new Error("Not Implemented");
    }

    // ????????????????????????????????????
    this.resourceService.addResourceToLocalCache(ctx, {
      envId: deploy.projectEnvId,
      buffer: buffer,
      respHeaders: cloneDeep(ctx.respHeaders),
    });

    return buffer;
  }
}
