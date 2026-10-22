# 镜像与 CasOS 安装

## 构建并发布镜像

```sh
cd apps/segscope-viz
scripts/package-release.sh <registry>/<namespace>/segscope-viz:0.3.0
docker push <registry>/<namespace>/segscope-viz:0.3.0
```

镜像包含页面、Go控制服务、固定执行包及选定的上游源码和MIT许可证。Python、浏览器和编译工作在授权目标机上完成；基础编译工具需已具备，E1首次准备需要下载软件。

仓库的 SegScope image 工作流会在相关PR中构建检查，并在官方默认分支收到相关修改后推送 `ghcr.io/casosorg/segscope-viz:0.3.0` 和 `latest`。首次发布后维护者需确认GHCR包的公开可见性。在镜像发布前，不应把这个地址当成已有可用镜像；市场模板要求填写实际已发布地址。

## CasOS应用商店

`store/builtin/segscope-viz.yaml` 注册商店入口，镜像地址为必填项。`marketplace/segscope-viz/index.yaml` 是同格式的独立模板。安装时填写实际已发布镜像，创建单副本 Deployment、1Gi结果PVC、Service和Ingress。

## Helm

```sh
helm upgrade --install segscope-viz ./release/segscope-viz-0.3.0.tgz \
  --set image.repository=<registry>/<namespace>/segscope-viz \
  --set image.tag=0.3.0
```

部署使用非root用户65532、只读根目录、移除全部Linux能力且不挂载ServiceAccount token。单实例Recreate更新，任务数据存在持久卷。控制服务必须能访问目标机SSH端口。

## 本地运行

```sh
docker run --rm -p 8080:8080 --read-only --cap-drop ALL \
  -v segscope-results:/data <registry>/<namespace>/segscope-viz:0.3.0
```

## 已验证范围

- Linux amd64镜像在containerd中以非root、只读根目录、移除默认能力方式实际启动，健康接口、静态页面及任务卷写入通过。
- E1/E3/E4已在授权Linux实验机完成有界真实执行；E2只导入，E4只做轻量性能比较。
- 电脑身份变化、取消任务、回传文件白名单及大小限制验证通过。
- AMD/ARM等其他环境尚未完成完整验证；执行目标当前要求x86_64 Linux。
- 没有发布公共镜像、没有完成官方应用上架；PR提供完整源码与构建、安装材料。
