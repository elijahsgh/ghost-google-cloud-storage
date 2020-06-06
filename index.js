'use strict';

const storage        = require('@google-cloud/storage'),
      Promise        = require('bluebird'),
      path           = require('path'),
      BaseAdapter    = require('ghost-storage-base'),
      activeTheme    = require(path.join(process.cwd(), 'current/core/frontend/services/themes/active')),
      fs             = require('fs-extra'),
      imageTransform = require('@tryghost/image-transform');

class GStore extends BaseAdapter {
    constructor(config = {}){
        super(config);

        var gcs = storage({
            projectId: config.projectId,
            keyFilename: config.key
        });
        this.bucket = gcs.bucket(config.bucket);
        this.assetDomain = config.assetDomain || `storage.googleapis.com/${config.bucket}`;
        this.assetPath = config.assetPath || '/';

        if(config.hasOwnProperty('assetDomain')) {
            if(!this.assetDomain.endsWith('/')) {
                this.assetDomain = this.assetDomain + '/';
            }
            this.insecure = config.insecure;
        }
        
        if(config.hasOwnProperty('assetPath')) {
            if(!this.assetPath.endsWith('/')) {
                this.assetPath = this.assetPath + '/';
            }
        }
        // default max-age is 3600 for GCS, override to something more useful
        this.maxAge = config.maxAge || 2678400;
    }

    /**
     *
     * @param image  image is the express image object
     * @param targetDir
     * @returns {*}
     */
    save(image, targetDir) {
        var targetDir = this.getTargetDir(),
            googleStoragePath = `http${this.insecure?'':'s'}://${this.assetDomain}`;
        var targetFilenameOut=null;
        var assetPath = this.assetPath;

        const imageSizes = activeTheme.get().config('image_sizes');

        const imageDimensions = Object.keys(imageSizes).reduce((dimensions, size) => {
            const {width, height} = imageSizes[size];
            const dimension = (width ? 'w' + width : '') + (height ? 'h' + height : '');
            return Object.assign({
                [dimension]: imageSizes[size]
            }, dimensions);
        }, {});

        return new Promise((resolve, reject) => {
            this.getUniqueFileName(image, targetDir).then(targetFilename => {
                var fileNamePath=null;
                if(targetFilename.indexOf(targetDir) === -1) {
                    fileNamePath =targetDir + targetFilename;
                } else {
                    fileNamePath=targetFilename;
                }
                targetFilenameOut=fileNamePath;

                if(!targetFilename.includes('_o.')) {
                    var data = fs.readFileSync(image.path);
                    Object.keys(imageDimensions).map(imageDimension => {
                        imageTransform.resizeFromBuffer(data, imageDimensions[imageDimension]).then((transformed) => {
                            this.saveRaw(transformed, assetPath + 'size/' + imageDimension + '/' + targetFilenameOut);
                        });
                    });
                }

                var opts = {
                    destination: this.assetPath + targetFilenameOut,
                    metadata: {
                        cacheControl: `public, max-age=${this.maxAge}`
                    },
                    public: true
                };
                return this.bucket.upload(image.path, opts);
            }).then(function (data) {
                return resolve( googleStoragePath + assetPath + targetFilenameOut);
            }).catch(function (e) {
                return reject(e);
            });
        });
    }

    /**
     * Saves a buffer in the targetPath
     * - buffer is an instance of Buffer
     * - returns a Promise which returns the full URL to retrieve the data
     */
    saveRaw(buffer, targetPath) {
        const targetDir = path.dirname(targetPath);
        const googleStoragePath = `http${this.insecure?'':'s'}://${this.assetDomain}`;

        return fs.mkdirs(targetDir)
            .then(() => {
                return fs.writeFile(targetPath, buffer);
            })
            .then(() => {
                var opts = {
                    destination: targetPath,
                    metadata: {
                        cacheControl: `public, max-age=${this.maxAge}`
                    },
                    public: true                    
                };
		console.log("Uploading " + targetPath + " with Google Adapter");
                this.bucket.upload(targetPath, opts);
            })
            .then(() => {
                fs.unlink(targetPath);
            })
            .then(() => {
                return googleStoragePath + targetPath;
            });
    }

    // middleware for serving the files
    serve() {
        // a no-op, these are absolute URLs
        return function (req, res, next) { next(); };
    }

    exists (filename, targetDir) {
        return this.bucket
            .file(path.join(targetDir, filename))
            .exists()
            .then(function(data){
                return data[0];
            })
            .catch(err => Promise.reject(err));
    }

    read (filename) {
        const googleStoragePath = `http${this.insecure?'':'s'}://${this.assetDomain}`;
        
        if(typeof filename.path !== 'undefined') {
            filename=filename.path;
        }
        if(filename.indexOf(googleStoragePath) !== -1){
            filename=filename.replace(googleStoragePath, '');
        }

        if(this.assetPath.endsWith('/') && filename.startsWith('/')) {
            filename = filename.substr(1);
        }
        
        console.log("Read " + this.assetPath + filename);

        try {
            var rs = this.bucket.file(this.assetPath + filename);
            return new Promise(function (resolve, reject) {
                rs.download()
                    .then(function(data){
                        resolve(data[0]);
                    });
            });
        } catch(e){
            console.log('STREAM TO DEATH', e);
        }
    }

    delete (filename) {
        return this.bucket.file(filename).delete();
    }
}

module.exports = GStore;
