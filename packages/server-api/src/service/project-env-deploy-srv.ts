import { Inject, Provide } from "@midwayjs/decorator";
import { Context } from "@midwayjs/koa";
import { ILogger } from "@midwayjs/logger";
import * as assert from "assert";
import * as _ from "lodash";
import { getConnection, In } from "typeorm";
import { EDeployTargetType, ProjectEnvDeploy, ProjectEnvDeployRepo } from "../entity/project-env-deploy";
import { User, UserRepo } from "../entity/user";
import { CustomError } from "../error/custom-error";
import { ICreateEnvDeployBody, IProjectEnvDeployDTO, IUrlCreateDTO } from "../interface/project-env-deploy.interface";
import { queryRunnerRepo } from "../util/query-runner-repo";

@Provide()
export class ProjectEnvDeploySrv {
  @Inject()
  private ctx: Context;

  @Inject()
  private logger: ILogger;

  async getEnvDeploys(envId: number): Promise<IProjectEnvDeployDTO[]> {
    const envDeployRepo = queryRunnerRepo(ProjectEnvDeployRepo);
    const envDeploys = await envDeployRepo.find({
      projectEnvId: envId,
      isDel: false,
    });

    const createUserIds = envDeploys.map((deploy) => deploy.createUserId);
    const actionUserIds = envDeploys.map((deploy) => deploy.actionUserId);
    const userIds = createUserIds.concat(actionUserIds);

    const userRepo = queryRunnerRepo(UserRepo);
    const users = await userRepo.find({
      id: In(userIds || []),
      isDel: false,
    });
    const userMap: Map<number, User> = new Map(users.map((user) => [user.id, user]));

    return envDeploys.map((deploy) => {
      const res: IProjectEnvDeployDTO = {
        ...deploy,
        createUser: User.purify(userMap.get(deploy.createUserId)),
        actionUser: User.purify(userMap.get(deploy.actionUserId)),
      };
      return res;
    });
  }

  async createEnvDeploy(
    projectId: number,
    projectEnvId: number,
    params: ICreateEnvDeployBody
  ): Promise<ProjectEnvDeploy> {
    const { type, options } = params;
    const { id: userId } = this.ctx.loginUser;

    if (type === "url") {
      const { target, remark } = options as IUrlCreateDTO;
      const envDeployRepo = queryRunnerRepo(ProjectEnvDeployRepo);
      return await envDeployRepo.save({
        projectId: projectId,
        projectEnvId: projectEnvId,
        remark: remark,
        targetType: EDeployTargetType.Cloud,
        target: target,
        createUserId: userId,
        actionUserId: userId,
        isActive: false,
      });
    }

    if (type === "zip") {
      throw CustomError.notImplemented();
    }

    throw CustomError.notImplemented();
  }

  async deleteEnvDeploy(deployId: number): Promise<void> {
    const projectEnvDeployRepo = queryRunnerRepo(ProjectEnvDeployRepo);
    const exist = await projectEnvDeployRepo.findOne({ id: deployId, isDel: false });
    assert(!_.isNil(exist), CustomError.new(`deploy with id ${deployId} doesn't exist.`));

    const deleteRes = await projectEnvDeployRepo.update(
      {
        id: exist.id,
        isDel: false,
      },
      {
        isDel: true,
      }
    );
    assert(deleteRes.affected > 0, CustomError.new(`????????????????????????`));
  }

  /**
   * ???????????????????????????
   */
  async activateEnvDeploy(deployId: number): Promise<void> {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.startTransaction();
    try {
      const projectEnvDeployRepo = queryRunnerRepo(ProjectEnvDeployRepo, queryRunner);
      const exist = await projectEnvDeployRepo.findOne({ id: deployId, isDel: false });
      assert(exist.isActive !== true, CustomError.new(`???????????????????????????????????????`));
      assert(!_.isNil(exist), CustomError.new(`???????????????????????????`));

      // ??????????????????????????? deploy ??????
      await projectEnvDeployRepo.update(
        {
          isActive: true,
          isDel: false,
        },
        {
          isActive: false,
        }
      );

      // ???????????? deploy ??????
      const updateRes = await projectEnvDeployRepo.update(
        {
          id: deployId,
          isDel: false,
        },
        {
          isActive: true,
        }
      );
      assert(updateRes.affected > 0, CustomError.new(`????????????????????????`));

      await queryRunner.commitTransaction();
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }

  /**
   * ???????????????????????????
   */
  async deactivateEnvDeploy(deployId: number): Promise<void> {
    const queryRunner = getConnection().createQueryRunner();
    await queryRunner.startTransaction();

    try {
      const projectEnvDeployRepo = queryRunnerRepo(ProjectEnvDeployRepo, queryRunner);
      const exist = await projectEnvDeployRepo.findOne({ id: deployId, isDel: false });
      assert(exist.isActive !== false, CustomError.new(`???????????????????????????????????????`));
      assert(!_.isNil(exist), CustomError.new(`???????????????????????????`));

      const updateRes = await projectEnvDeployRepo.update(
        {
          id: deployId,
          isDel: false,
        },
        {
          isActive: false,
        }
      );
      assert(updateRes.affected > 0, CustomError.new("????????????????????????"));
    } catch (err) {
      await queryRunner.rollbackTransaction();
      throw err;
    } finally {
      await queryRunner.release();
    }
  }
}
