import editJsonFile from "edit-json-file";
import fibrous from "fibrous";
import fs from "fs";
import RegClient from "npm-registry-client";
import targz from "targz";
import { CustomArgv } from "./cli.const";
import { getAuth } from "./index.service";
import { logger } from "./logger";

const npm = new RegClient();

export const cli = fibrous((argv: CustomArgv) => {
  const modules = argv._;

  const srcAuth = getAuth('src', argv);
  const destAuth = getAuth('dest', argv);

  const { dest, destPrefix, destRepo, src, srcPrefix } = argv;

  modules.forEach(module => {
    const srcName = srcPrefix ? `${srcPrefix}/${module}` : module;
    const destName = destPrefix ? `${destPrefix}/${module}` : module;

    const srcUrl = `${src}/${srcName}`;
    const destUrl = `${dest}/${destName}`;

    const baseConfig = { timeout: 3000 };
    const srcConfig = { ...baseConfig, auth: srcAuth };
    const destConfig = { ...baseConfig, auth: destAuth };

    try {
      logger.info("Compairing registries. Getting versions from source...", "🔎");
      const srcVersions = npm.sync.get(srcUrl, srcConfig).versions;

      logger.info("Compairing registries. Getting versions from destination...", "🔎");
      const destVersions = npm.sync.get(destUrl, destConfig).versions;

      const srcKeys = Object.keys(srcVersions);
      const destKeys = Object.keys(destVersions);

      // Hat Tip: https://medium.com/@alvaro.saburido/set-theory-for-arrays-in-es6-eb2f20a61848
      const versionsToMigrate = srcKeys.filter(x => !destKeys.includes(x));
      const versionCount = versionsToMigrate.length;

      if (versionCount === 0) {
        logger.ok('No items differ. Nothing to migrate!', "✅");
        process.exit(0)
      }

      versionsToMigrate.forEach((versionName, index) => {
        logger.info(`Migrating ${index + 1} of ${versionCount}...`, "📡");

        const srcMetadata = srcVersions[versionName];
        const { dist } = srcMetadata;

        const destMetadata = { ...srcMetadata }

        // Delete private properties and the 'dist' object.
        delete destMetadata._;
        delete destMetadata.dist;

        if (destRepo) {
          const tmpPath = `${__dirname}/tmp/${versionName}`;
          const fileName = `${versionName}.tgz`;
          const packagePath = `${tmpPath}/package`;

          const srcFilePath = `${tmpPath}/${fileName}`;
          const srcPackageFilePath = `${packagePath}/package.json`;

          const destFilePath = `${packagePath}/${fileName}`;

          fs.mkdirSync(tmpPath, { recursive: true })

          const tgzFile = fs.createWriteStream(srcFilePath);
          npm.sync.fetch(dist.tarball, { auth: srcAuth }).pipe(tgzFile);

          targz.decompress({ src: srcFilePath, dest: tmpPath }, () => {
            const file = editJsonFile(srcPackageFilePath);
            file.set("repository.url", destRepo);
            file.save();

            targz.compress({ src: packagePath, dest: destFilePath }, () => {
              const tarball = fs.createReadStream(destFilePath);
              npm.publish(dest, { auth: destAuth, metadata: destMetadata, access: 'public', body: tarball }, () => {
                logger.ok(`${index + 1} migrated!`, "✅")
              })
            })
          });
        } else {
          // const tarball = npm.sync.fetch(dist.tarball, { auth: srcAuth });
        }

        /*


        npm.sync.publish(dest, { auth: destAuth, metadata: destMetadata, access: 'public', body: tarball })

        logger.ok(`${versionName} migrated!`, "✅")
        */
      })
    } catch (err) {
      logger.error(__filename, "💥");
      logger.error(err, "💥");
    }
  })
})
