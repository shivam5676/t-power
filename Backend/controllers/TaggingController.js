


import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { convert } from 'pdf-poppler';
import { v4 as uuidv4 } from 'uuid';
import PDFDocument from 'pdfkit';
import { createCanvas, Image } from 'canvas';
import { BrowserQRCodeReader } from '@zxing/library';
import Tagging from '../models/tagging.js';
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);


export const extractPdfController = async (req, res) => {
    try {
        const filePath = path.join(__dirname, '..', 'uploads', req.file.filename);

        // Check if file exists
        if (!fs.existsSync(filePath)) {
            return res.status(400).json({ error: 'File does not exist' });
        }

        // Create a unique directory for this conversion
        const uniqueDirName = uuidv4(); // Generate a unique identifier
        const outputDir = path.join(__dirname, '..', 'images', uniqueDirName);

        // Ensure that the parent directories exist
        const parentDir = path.dirname(outputDir);
        if (!fs.existsSync(parentDir)) {
            fs.mkdirSync(parentDir, { recursive: true });
        }

        // Create the unique directory
        fs.mkdirSync(outputDir, { recursive: true });

        const options = {
            format: 'png',
            out_dir: outputDir,
            out_prefix: 'page', // Ensure this prefix is used for the converted images
            page_numbers: null,
        };

        await convert(filePath, options); // Convert PDF to images

        // Filter images based on prefix and format
        const imageFiles = fs.readdirSync(outputDir)
        // .filter(file => file.startsWith('page_') && file.endsWith('.png'));
        // Construct URLs for the filtered images
        const imageUrls = imageFiles.map(file => path.join('/images', uniqueDirName, file));
        const imagePath = outputDir + "/page-1.png"
        console.log(imagePath);
        readBarcodeFromImage(imagePath)
            .then((barcode) => {
                console.log('Barcode:', barcode);
                res.status(200).json({
                    success: true,
                    barcode: barcode,
                    message: 'PDF converted to images',
                    images: imageUrls,
                });
            })
            .catch((error) => {
                console.error('Error:', error);
                res.status(200).json({
                    success: true,
                    message: 'Error in Reading barcode.',
                    error: error.message,
                    images: imageUrls,
                });
            });
        // Return the images extracted in this call

    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: 'Error in extracting pdf',
            error: error.message
        });
    }
}


export const convertImageToPdfController = async (req, res) => {
    try {
        const { imageNames, csa, document, fileDataId } = req.body; // Expecting an array of image names

        if (!Array.isArray(imageNames) || imageNames.length === 0) {
            return res.status(400).json({ error: 'No images provided' });
        }

        const outputDir = path.join(__dirname, '..', 'pdfs');
        const pdfFileName = `${csa}_${document}.pdf`; // Unique name for the PDF
        const pdfPath = path.join(outputDir, pdfFileName);

        // Ensure the directory exists
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const doc = new PDFDocument();
        const writeStream = fs.createWriteStream(pdfPath);

        // Pipe the PDF into a file
        doc.pipe(writeStream);

        let imagesAdded = false;

        try {
            for (const imageName of imageNames) {
                const imagePath = path.join(__dirname, '..', imageName);
                console.log(`Processing image: ${imagePath}`);

                await new Promise((resolve, reject) => {
                    fs.access(imagePath, fs.constants.F_OK, (err) => {
                        if (err) {
                            console.error(`Image not found: ${imageName}`);
                            reject(new Error(`Image not found: ${imageName}`));
                            return;
                        }

                        if (!imagesAdded) {
                            imagesAdded = true; // The first image will start the document
                        } else {
                            doc.addPage(); // Add a new page for subsequent images
                        }

                        doc.image(imagePath, { fit: [500, 700], align: 'center', valign: 'center' });
                        console.log(`Added image to PDF: ${imageName}`);
                        resolve(); // Resolve after processing the image
                    });
                });
            }

            if (imagesAdded) {
                doc.end();
            } else {
                throw new Error('No valid images were added to the PDF');
            }

            writeStream.on('finish', async () => {

                await Tagging.create({
                    documentName: document,
                    pdfFileName: pdfFileName,
                    fileDataId: fileDataId
                });
                res.json({
                    success: true,
                    message: 'PDF created and stored successfully',
                    pdfUrl: path.join('/pdfs', pdfFileName), // URL to access the PDF
                });
            });

            writeStream.on('error', (err) => {
                console.error('Error writing PDF file:', err);
                res.status(500).json({ success: false, message: 'Failed to create PDF', error: 'Failed to create PDF' });
            });
        } catch (error) {
            console.error('Error processing images:', error);
            // Delete the partially created PDF file
            if (fs.existsSync(pdfPath)) {
                fs.unlinkSync(pdfPath);
            }
            res.status(500).json({ success: false, message: error.message, error: error.message });
        }
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: 'Failed to create PDF',
            error: error.message
        });
    }
}


export const downloadPdfController = async (req, res) => {
    try {
        const { pdfName } = req.body;

        if (!pdfName) {
            return res.status(400).json({ error: 'PDF name is required' });
        }

        // Construct the file path
        const filePath = path.join(__dirname, '..', 'pdfs', pdfName);

        // Check if the file exists
        fs.access(filePath, fs.constants.F_OK, (err) => {
            if (err) {
                return res.status(404).json({ error: 'File not found' });
            }

            // Set the appropriate headers and send the file
            res.sendFile(filePath, (err) => {
                if (err) {
                    return res.status(500).json({ error: 'Error sending file' });
                }
            });
        });
    } catch (error) {
        console.log(error);
        res.status(500).json({
            success: false,
            message: 'Failed to download PDF',
            error: error.message
        });
    }
}






const readBarcodeFromImage = (imagePath) => {
    return new Promise((resolve, reject) => {
        // Load the image
        const img = new Image();
        img.onload = async () => {
            const canvas = createCanvas(img.width, img.height);
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, img.width, img.height);

            // Preprocess the image (e.g., convert to grayscale)
            const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
            const grayscaleImageData = convertToGrayscale(imageData);
            ctx.putImageData(grayscaleImageData, 0, 0);

            // Create a ZXing barcode reader instance
            const codeReader = new BrowserQRCodeReader();

            try {
                // Read the barcode from the image
                const result = await codeReader.decodeFromImageElement(canvas);
                resolve(result.text);
            } catch (err) {
                reject(new Error('No barcode detected'));
            }
        };

        img.onerror = (err) => {
            console.error('Image load error:', err);
            reject(new Error('Error loading image'));
        };

        img.src = imagePath;
    });
};




const convertToGrayscale = (imageData) => {
    const data = imageData.data;
    for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = avg;       // Red
        data[i + 1] = avg;   // Green
        data[i + 2] = avg;   // Blue
    }
    return imageData;
};