import axios from "axios"
import { post, del, get, put } from "./api_helper"
import * as url from "./url_helper"

// Create Class
export const createPdfFromImages = data => post(url.CREATE_PDF_FROM_IMAGES, data);