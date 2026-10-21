import {serve} from '../src/web.js';
import assets from '../src/generated/assets.js';
export default {fetch(request,env){return serve(request,env,assets);}};
