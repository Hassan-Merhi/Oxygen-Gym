import fs from "node:fs";

const specPath = "lib/api-spec/openapi.yaml";
let spec = fs.readFileSync(specPath, "utf8");

if (spec.includes("operationId: GetFinancials")) {
  console.log("Phase 3 OpenAPI paths already present.");
  process.exit(0);
}

const marker = "\ncomponents:\n";
if (!spec.includes(marker)) throw new Error("Could not locate OpenAPI components marker");

const paths = String.raw`
  /users/{id}/reset-password:
    post:
      summary: Reset a user's password
      operationId: ResetUserPassword
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [password]
              properties:
                password: { type: string, minLength: 6 }
      responses:
        '200':
          description: Password reset
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }

  /upload:
    post:
      summary: Upload an image
      operationId: UploadImage
      requestBody:
        required: true
        content:
          multipart/form-data:
            schema:
              type: object
              required: [file]
              properties:
                file:
                  type: string
                  format: binary
      responses:
        '200':
          description: Uploaded image URL
          content:
            application/json:
              schema:
                type: object
                required: [url]
                properties:
                  url: { type: string }

  /payments/{id}/send-receipt:
    post:
      summary: Send a payment receipt through WhatsApp
      operationId: SendPaymentReceipt
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      responses:
        '200':
          description: Receipt sent
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }

  /accounts/chart:
    get:
      summary: List chart of accounts
      operationId: ListChartAccounts
      responses:
        '200':
          description: Accounts
          content:
            application/json:
              schema:
                type: array
                items:
                  type: object
                  additionalProperties: true
    post:
      summary: Create chart account
      operationId: CreateChartAccount
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [name, type]
              properties:
                name: { type: string, minLength: 1 }
                type: { type: string, minLength: 1 }
                description: { type: string, nullable: true }
      responses:
        '201':
          description: Created account
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true

  /accounts/chart/{id}:
    put:
      summary: Update chart account
      operationId: UpdateChartAccount
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              properties:
                name: { type: string }
                type: { type: string }
                description: { type: string, nullable: true }
                isActive: { type: boolean }
      responses:
        '200':
          description: Updated account
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true
    delete:
      summary: Deactivate chart account
      operationId: DeactivateChartAccount
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
      responses:
        '200':
          description: Account deactivated
          content:
            application/json:
              schema:
                type: object
                required: [ok, deactivated]
                properties:
                  ok: { type: boolean }
                  deactivated: { type: boolean }

  /accounts/chart/{id}/statement:
    get:
      summary: Get account statement
      operationId: GetChartAccountStatement
      parameters:
        - in: path
          name: id
          required: true
          schema: { type: integer }
        - in: query
          name: dateFrom
          schema: { type: string }
        - in: query
          name: dateTo
          schema: { type: string }
      responses:
        '200':
          description: Account statement
          content:
            application/json:
              schema:
                type: object
                additionalProperties: true

  /financials:
    get:
      summary: Get filtered financial report
      operationId: GetFinancials
      parameters:
        - in: query
          name: period
          schema:
            type: string
            enum: [today, month, last_month, year, custom]
            default: month
        - in: query
          name: dateFrom
          schema: { type: string }
        - in: query
          name: dateTo
          schema: { type: string }
      responses:
        '200':
          description: Financial report
          content:
            application/json:
              schema:
                type: object
                required: [period, dateFrom, dateTo, rate, currency, revenue, expenses, net, categories, months]
                properties:
                  period: { type: string, enum: [today, month, last_month, year, custom] }
                  dateFrom: { type: string }
                  dateTo: { type: string }
                  rate: { type: number }
                  currency:
                    type: object
                    required: [base, display]
                    properties:
                      base: { type: string, enum: [USD] }
                      display: { type: string, enum: [CDF] }
                  revenue: { $ref: '#/components/schemas/MoneyPair' }
                  expenses: { $ref: '#/components/schemas/MoneyPair' }
                  net: { $ref: '#/components/schemas/MoneyPair' }
                  categories:
                    type: array
                    items:
                      type: object
                      required: [category, kind, usd, cdf]
                      properties:
                        category: { type: string }
                        kind: { type: string, enum: [revenue, expense] }
                        usd: { type: number }
                        cdf: { type: number }
                  months:
                    type: array
                    items:
                      type: object
                      required: [key, label, revenue, expenses, net, transactions]
                      properties:
                        key: { type: string }
                        label: { type: string }
                        revenue: { $ref: '#/components/schemas/MoneyPair' }
                        expenses: { $ref: '#/components/schemas/MoneyPair' }
                        net: { $ref: '#/components/schemas/MoneyPair' }
                        transactions:
                          type: array
                          items:
                            type: object
                            required: [id, sourceType, sourceId, reference, date, dateKey, monthKey, kind, category, description, party, amountUsd, amountCdf]
                            properties:
                              id: { type: string }
                              sourceType: { type: string, enum: [payment, voucher, sale_revenue, sale_cogs] }
                              sourceId: { type: integer }
                              reference: { type: string }
                              date: { type: string }
                              dateKey: { type: string }
                              monthKey: { type: string }
                              kind: { type: string, enum: [revenue, expense] }
                              category: { type: string }
                              description: { type: string }
                              party: { type: string }
                              amountUsd: { type: number }
                              amountCdf: { type: number }

  /whatsapp/state:
    get:
      summary: Get WhatsApp instance state
      operationId: GetWhatsappState
      responses:
        '200':
          description: Instance state
          content:
            application/json:
              schema:
                type: object
                required: [state]
                properties:
                  state: { type: string }

  /whatsapp/broadcast:
    post:
      summary: Broadcast a WhatsApp message
      operationId: BroadcastWhatsappMessage
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              required: [message]
              properties:
                message: { type: string, minLength: 1 }
      responses:
        '200':
          description: Broadcast result
          content:
            application/json:
              schema:
                type: object
                required: [ok]
                properties:
                  ok: { type: boolean }
`;

// MoneyPair is shared only by the new financial report contract. Insert it as a
// component schema as well as adding the missing paths.
spec = spec.replace(marker, `${paths}${marker}`);
const schemasMarker = "  schemas:\n";
if (!spec.includes(schemasMarker)) throw new Error("Could not locate schemas section");
spec = spec.replace(schemasMarker, `${schemasMarker}    MoneyPair:\n      type: object\n      required: [usd, cdf]\n      properties:\n        usd: { type: number }\n        cdf: { type: number }\n`);

fs.writeFileSync(specPath, spec);
console.log("Phase 3 missing OpenAPI paths added.");
