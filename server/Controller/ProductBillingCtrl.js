const Product = require("../Models/ProductModel");
const Invoice = require("../Models/BillingModel");
const Ledger = require("../Models/customerLedger");
const Customer = require("../Models/CustomerModel");
const Salesman = require("../Models/SalesManModel");

const mongoose = require("mongoose");

const createBilling = async (req, res) => {
  // console.log("[createBilling] Incoming:", req.body);

  try {
    const { customer, billing, finalAmount } = req.body;

    const {
      Billdate,
      paymentMode,
      customerName,
      salesmanName, // input wala name
      selectedBeatId,
      selectedCustomerId,
      selectedSalesmanId,
      billingType,
    } = customer;

    const pendingAmount = Number(finalAmount);

    // ✅ Customer doc
    const existingCustomer = await Customer.findById(selectedCustomerId);
    if (!existingCustomer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    // ✅ Salesman doc (optional)
    const existingSalesman = await Salesman.findById(selectedSalesmanId);

    // ✅ 1) Prepare nested customer info for Invoice
    const customerForInvoice = {
      CustomerName: customerName || existingCustomer.name || "",
      Billdate: new Date(Billdate),
      paymentMode: paymentMode || "",
      salesmanName: salesmanName || existingSalesman?.name || "",
      selectedBeatId: selectedBeatId || null,
      selectedCustomerId: selectedCustomerId || null,
      selectedSalesmanId: selectedSalesmanId || null,
      billingType: billingType || "Credit",
    };

    // ✅ 2) Create Invoice with names in top-level fields too
    const invoice = new Invoice({
      customer: customerForInvoice,
      billing,
      billingType,
      finalAmount: pendingAmount,
      pendingAmount: pendingAmount,
      customerId: selectedCustomerId,
      customerName: existingCustomer.name,
      salesmanId: selectedSalesmanId,
      salesmanName: existingSalesman?.name || "",
    });

    await invoice.save();

    // ✅ 3) Update Customer balance
    existingCustomer.totalBalance += pendingAmount;
    await existingCustomer.save();

    // ✅ 4) Ledger entry
    const ledger = new Ledger({
      refType: "invoice",
      refId: invoice._id,
      narration: `Invoice created for customer ${existingCustomer.name}`,
      debitAccount: `Customer: ${existingCustomer.name}`,
      creditAccount: "Sales Income",
      amount: pendingAmount,
      companyId: invoice.companyId,
      customerId: existingCustomer._id,
    });

    await ledger.save();

    // ✅ 5) Link ledger
    invoice.ledgerIds = invoice.ledgerIds || [];
    invoice.ledgerIds.push(ledger._id);
    await invoice.save();

    // ✅ 6) Update stock
    for (const item of billing) {
      if (!item.productId) {
        throw new Error(`Product ID missing`);
      }

      const totalQtyToDeduct = (item.qty || 0) + (item.Free || 0);
      const product = await Product.findById(item.productId);

      if (!product) throw new Error(`Product not found: ${item.productId}`);

      if (product.availableQty < totalQtyToDeduct) {
        throw new Error(
          `Not enough stock for ${product.productName}. Available: ${product.availableQty}, Required: ${totalQtyToDeduct}`
        );
      }

      product.availableQty -= totalQtyToDeduct;
      product.lastUpdated = new Date();
      await product.save();
    }

    res.status(201).json({
      message: "Invoice created successfully",
      invoice,
    });
  } catch (err) {
    console.error("[createBilling] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

// ✅ PUT /pro-billing/:id
const updateBilling = async (req, res) => {
  try {
    const invoiceId = req.params.id;
    const { customer, billing, finalAmount } = req.body;

    const {
      Billdate,
      paymentMode,
      customerName,
      salesmanName,
      selectedBeatId,
      selectedCustomerId,
      selectedSalesmanId,
      billingType,
    } = customer;

    const pendingAmount = Number(finalAmount);

    // ✅ Find existing invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // ✅ Find customer & salesman
    const existingCustomer = await Customer.findById(selectedCustomerId);
    if (!existingCustomer) {
      return res.status(404).json({ error: "Customer not found" });
    }

    const existingSalesman = await Salesman.findById(selectedSalesmanId);

    // ✅ Restore stock for previous billing (Optional but IMPORTANT!)
    for (const oldItem of invoice.billing) {
      const totalQty = (oldItem.qty || 0) + (oldItem.Free || 0);
      const product = await Product.findById(oldItem.productId);
      if (product) {
        product.availableQty += totalQty; // Revert previous stock deduction
        await product.save();
      }
    }

    // ✅ Update fields
    invoice.customer = {
      CustomerName: customerName || existingCustomer.name || "",
      Billdate: new Date(Billdate),
      paymentMode: paymentMode || "",
      salesmanName: salesmanName || existingSalesman?.name || "",
      selectedBeatId: selectedBeatId || null,
      selectedCustomerId: selectedCustomerId || null,
      selectedSalesmanId: selectedSalesmanId || null,
      billingType: billingType || "Credit",
    };
    invoice.billing = billing;
    invoice.billingType = billingType;
    invoice.finalAmount = pendingAmount;
    invoice.pendingAmount = pendingAmount; // or handle partial payments logic here
    invoice.customerId = selectedCustomerId;
    invoice.customerName = existingCustomer.name;
    invoice.salesmanId = selectedSalesmanId;
    invoice.salesmanName = existingSalesman?.name || "";

    await invoice.save();

    // ✅ Update Customer balance — adjust difference only
    const oldBalance = invoice.finalAmount;
    const balanceDiff = pendingAmount - oldBalance;
    existingCustomer.totalBalance += balanceDiff;
    await existingCustomer.save();

    // ✅ Delete old ledger entries and add new one if you want
    // Or update them smartly
    await Ledger.deleteMany({ refType: "invoice", refId: invoice._id });

    const ledger = new Ledger({
      refType: "invoice",
      refId: invoice._id,
      narration: `Invoice updated for customer ${existingCustomer.name}`,
      debitAccount: `Customer: ${existingCustomer.name}`,
      creditAccount: "Sales Income",
      amount: pendingAmount,
      companyId: invoice.companyId,
      customerId: existingCustomer._id,
    });
    await ledger.save();

    invoice.ledgerIds = [ledger._id];
    await invoice.save();

    // ✅ Deduct stock for new billing
    for (const item of billing) {
      const totalQtyToDeduct = (item.qty || 0) + (item.Free || 0);
      const product = await Product.findById(item.productId);
      if (!product) {
        throw new Error(`Product not found: ${item.productId}`);
      }
      if (product.availableQty < totalQtyToDeduct) {
        throw new Error(
          `Not enough stock for ${product.productName}. Available: ${product.availableQty}, Required: ${totalQtyToDeduct}`
        );
      }
      product.availableQty -= totalQtyToDeduct;
      product.lastUpdated = new Date();
      await product.save();
    }

    res.status(200).json({
      message: "Invoice updated successfully",
      invoice,
    });
  } catch (err) {
    console.error("[updateBilling] Error:", err);
    res.status(500).json({ error: err.message });
  }
};

const getAllInvoices = async (req, res) => {
  try {
    const invoices = await Invoice.find()
      .sort({ createdAt: -1 })
      .populate("companyId") // or add fields if you want to limit
      .populate("salesmanId")
      .populate("billing.productId") // ✅ full product details
      .populate("customerId"); // ✅ full customer details
    // console.log(invoices, "invoice");
    res.status(200).json(invoices);
  } catch (error) {
    console.error("Error fetching invoices:", error);
    res.status(500).json({ error: "Failed to fetch invoices" });
  }
};

// DELETE /pro-billing/:id
const deleteInvoice = async (req, res) => {
  const { id } = req.params;
  try {
    const deleted = await Invoice.findByIdAndDelete(id);
    if (!deleted) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    await Ledger.deleteMany({ invoiceId: id });
    res.status(200).json({ message: "Invoice deleted successfully" });
  } catch (error) {
    console.error("Error deleting invoice:", error);
    res.status(500).json({ error: "Failed to delete invoice" });
  }
};

// Get  invoice by id
const getInvoiceById = async (req, res) => {
  try {
    const invoice = await Invoice.findById(req.params.id)
      .populate("companyId")
      .populate("salesmanId")
      .populate("billing.productId")
      .populate("customerId", "firm name mobile address gstNumber");

    if (!invoice) {
      return res.status(404).json({ message: "Invoice not found" });
    }

    // Format billing fields
    const formattedBilling = invoice.billing.map((item) => ({
      ...item.toObject(),
      rate: item.rate.toFixed(2),
      amount: item.amount.toFixed(2),
      total: item.total.toFixed(2),
      cdAmt: item.cdAmt.toFixed(2),
      schAmt: item.schAmt.toFixed(2),
      gst: Number(item.gst).toFixed(1), // single decimal place
      cd: `${Number(item.cd).toFixed(1)}%`,
      sch: `${Number(item.sch).toFixed(1)}%`,
    }));

    // Create a formatted response with modified billing
    const formattedInvoice = {
      ...invoice.toObject(),
      billing: formattedBilling,
    };

    res.status(200).json(formattedInvoice);
  } catch (error) {
    console.error("Error fetching invoice:", error);
    res.status(500).json({ error: "Failed to fetch invoice" });
  }
};

const getInvoicesByCustomer = async (req, res) => {
  const { customerIdOrName } = req.params;

  try {
    if (!customerIdOrName) {
      return res.status(400).json({
        error: "Customer ID or Name is required",
      });
    }

    // ✅ Find by ID, nested ID or Customer Name (case-insensitive)
    const invoices = await Invoice.find({
      $or: [
        { customerId: customerIdOrName },
        { "customer.selectedCustomerId": customerIdOrName },
        {
          "customer.CustomerName": {
            $regex: new RegExp(customerIdOrName, "i"),
          },
        },
      ],
    })
      .sort({ createdAt: -1 })
      .populate("companyId", "companyName") // only specific fields
      .populate("salesmanId", "name")
      .populate("billing.productId", "productName")
      .populate("customerId", "name");

    if (!invoices || invoices.length === 0) {
      return res.status(404).json({
        message: `No invoices found for '${customerIdOrName}'`,
      });
    }

    res.status(200).json({
      message: "Invoices fetched successfully",
      count: invoices.length,
      invoices,
    });
  } catch (error) {
    console.error("[getInvoicesByCustomer] Error:", error);
    res.status(500).json({
      error: "Failed to fetch customer invoices",
      details: error.message,
    });
  }
};

const getBalanceByCustomer = async (req, res) => {
  try {
    // console.log(req.params, "➡️ Get Balance by Customer");

    const { customerId } = req.params;

    if (!customerId) {
      return res.status(400).json({ message: "Customer ID is required" });
    }

    const result = await Invoice.aggregate([
      {
        $match: {
          customerId: new mongoose.Types.ObjectId(customerId), // ✅ FIXED
        },
      },
      {
        $group: {
          _id: "$customerId",
          totalBalance: { $sum: { $toDouble: "$pendingAmount" } },
        },
      },
    ]);

    const balance = result[0]?.totalBalance || 0;

    res.status(200).json({ balance });
  } catch (err) {
    console.error("Error fetching customer balance:", err.message);
    res.status(500).json({ message: "Server error" });
  }
};

const adjustNewRef = async (req, res) => {
  // console.log("[adjustPayment] Incoming:", req.body);

  try {
    const { invoiceId, amount, paymentMode, note } = req.body;

    if (!invoiceId || !amount) {
      return res
        .status(400)
        .json({ error: "Invoice ID and amount are required" });
    }

    // ✅ Find the invoice
    const invoice = await Invoice.findById(invoiceId);
    if (!invoice) {
      return res.status(404).json({ error: "Invoice not found" });
    }

    // console.log("Invoice found:", invoice);

    if (amount > invoice.pendingAmount) {
      return res.status(400).json({
        error: `Amount exceeds pending amount. Pending: ${invoice.pendingAmount}`,
      });
    }

    // ✅ Deduct the payment
    invoice.pendingAmount -= amount;

    // ✅ Update status
    if (invoice.pendingAmount === 0) {
      invoice.status = "cleared";
    } else {
      invoice.status = "partial";
    }

    // ✅ Push to payments array
    invoice.payments.push({
      amount,
      date: new Date(),
      mode: paymentMode || "Cash",
      txnId: note || "",
    });

    await invoice.save();

    // ✅ Update Customer totalBalance also if needed
    const customer = await Customer.findById(invoice.customerId);
    if (customer) {
      customer.totalBalance -= amount;
      await customer.save();
    }

    // ✅ Create Ledger Entry
    const ledger = new Ledger({
      refType: "invoice_payment",
      refId: invoice._id,
      narration: `Payment adjusted for invoice #${invoice._id}`,
      debitAccount: "Cash/Bank",
      creditAccount: `Customer: ${
        customer?.name || invoice.customer.CustomerName
      }`,
      amount: amount,
      customerId: invoice.customerId,
      companyId: invoice.companyId,
    });

    await ledger.save();

    // ✅ Link ledger to invoice
    invoice.ledgerIds.push(ledger._id);
    await invoice.save();

    res.status(200).json({
      message: "Payment adjusted successfully",
      invoice,
      ledger,
    });
  } catch (error) {
    console.error("[adjustPayment] Error:", error);
    res.status(500).json({ error: error.message });
  }
};

const applyNewRef = async (req, res) => {
  try {
    const { customerId, amount, refType } = req.body;

    if (!customerId || !refType) {
      return res
        .status(400)
        .json({ message: "Customer ID & refType required" });
    }

    const customer = await Customer.findById(customerId);
    if (!customer) {
      return res.status(404).json({ message: "Customer not found" });
    }

    // ✅ Find all open/pending invoices — sorted oldest first
    const invoices = await Invoice.find({
      customerId: customerId,
      pendingAmount: { $gt: 0 },
    }).sort({ billDate: 1 });

    if (invoices.length === 0) {
      return res.status(400).json({ message: "No pending invoices found" });
    }

    let totalAdjusted = 0;

    if (refType === "new_ref") {
      if (!amount || amount <= 0) {
        return res
          .status(400)
          .json({ message: "Amount must be greater than zero for new_ref" });
      }

      let remainingAmount = amount;

      for (const invoice of invoices) {
        if (remainingAmount <= 0) break;

        const applyAmount = Math.min(invoice.pendingAmount, remainingAmount);

        invoice.pendingAmount -= applyAmount;
        remainingAmount -= applyAmount;
        totalAdjusted += applyAmount;

        invoice.adjustments.push({
          type: "new_ref",
          amount: applyAmount,
          note: "New Ref Adjustment",
        });

        if (invoice.pendingAmount === 0) {
          invoice.status = "cleared";
        } else {
          invoice.status = "partial";
        }

        const ledger = new Ledger({
          refType: "new_ref",
          refId: invoice._id,
          narration: `New Ref applied on invoice #${invoice._id}`,
          debitAccount: "Cash/Bank",
          creditAccount: `Customer: ${customer.name}`,
          amount: applyAmount,
          companyId: invoice.companyId,
          customerId: customer._id,
        });

        await ledger.save();

        invoice.ledgerIds.push(ledger._id);
        await invoice.save();
      }

      // ✅ Adjust customer total balance
      customer.totalBalance -= totalAdjusted;
      await customer.save();

      return res.status(200).json({
        message: `New Ref applied. Total adjusted: ${totalAdjusted}`,
        remainingAmount,
        customerId: customerId,
      });
    } else if (refType === "clear_ref") {
      // ✅ Clear ALL invoices directly
      for (const invoice of invoices) {
        totalAdjusted += invoice.pendingAmount;

        invoice.pendingAmount = 0;
        invoice.status = "cleared";

        invoice.adjustments.push({
          type: "clear_ref",
          amount: totalAdjusted,
          note: "Full Clear Ref",
        });

        const ledger = new Ledger({
          refType: "clear_ref",
          refId: invoice._id,
          narration: `Cleared invoice #${invoice._id} by Clear Ref`,
          debitAccount: "Manual Clear",
          creditAccount: `Customer: ${customer.name}`,
          amount: invoice.pendingAmount,
          companyId: invoice.companyId,
          customerId: customer._id,
        });

        await ledger.save();

        invoice.ledgerIds.push(ledger._id);
        await invoice.save();
      }

      // ✅ Adjust customer total balance too
      customer.totalBalance -= totalAdjusted;
      await customer.save();

      return res.status(200).json({
        message: `Clear Ref applied. Total cleared: ${totalAdjusted}`,
        customerId: customerId,
      });
    } else {
      return res
        .status(400)
        .json({ message: "Invalid refType. Must be 'new_ref' or 'clear_ref'" });
    }
  } catch (error) {
    console.error("Error in applyNewRef:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
};

// ✅ GET /api/invoices/by-salesman/:salesmanId

// const getInvoicesBySalesman = async (req, res) => {
//   try {
//     const { salesmanId } = req.params;

//     if (!salesmanId) {
//       return res.status(400).json({ message: "Salesman ID is required" });
//     }

//     const result = await Invoice.aggregate([
//       {
//         $match: {
//           $or: [
//             { salesmanId: new mongoose.Types.ObjectId(salesmanId) },
//             {
//               "customer.selectedSalesmanId": new mongoose.Types.ObjectId(
//                 salesmanId
//               ),
//             },
//           ],
//         },
//       },
//       {
//         $addFields: {
//           daysPending: {
//             $dateDiff: {
//               startDate: {
//                 $ifNull: [
//                   "$customer.Billdate",
//                   { $ifNull: ["$billDate", "$createdAt"] },
//                 ],
//               },
//               endDate: "$$NOW",
//               unit: "day",
//             },
//           },
//         },
//       },
//       {
//         $group: {
//           _id: null,
//           totalPendingAmount: { $sum: "$pendingAmount" },
//           invoices: { $push: "$$ROOT" },
//         },
//       },
//     ]);

//     if (!result.length) {
//       return res.status(404).json({
//         message: `No invoices found for salesman ID '${salesmanId}'`,
//       });
//     }

//     const { totalPendingAmount, invoices } = result[0];

//     res.status(200).json({
//       message: "Invoices fetched successfully",
//       count: invoices.length,
//       totalPendingAmount,
//       invoices,
//     });
//   } catch (error) {
//     console.error("[getInvoicesBySalesman] Error:", error);
//     res.status(500).json({
//       error: "Failed to fetch salesman invoices",
//       details: error.message,
//     });
//   }
// };

const getInvoicesBySalesman = async (req, res) => {
  try {
    const { salesmanId } = req.params;

    if (!salesmanId) {
      return res.status(400).json({ message: "Salesman ID is required" });
    }

    const result = await Invoice.aggregate([
      {
        $match: {
          $and: [
            {
              $or: [
                { salesmanId: new mongoose.Types.ObjectId(salesmanId) },
                {
                  "customer.selectedSalesmanId": new mongoose.Types.ObjectId(
                    salesmanId
                  ),
                },
              ],
            },
            {
              pendingAmount: { $gt: 0 }, // ✅ ONLY pendingAmount > 0
            },
          ],
        },
      },
      {
        $addFields: {
          daysPending: {
            $dateDiff: {
              startDate: "$billDate",
              endDate: "$$NOW",
              unit: "day",
            },
          },
        },
      },
      { $sort: { createdAt: -1 } },
    ]);

    if (!result || result.length === 0) {
      return res.status(404).json({
        message: `No invoices found for salesman ID '${salesmanId}'`,
      });
    }

    // ✅ Total pending amount sum
    const totalPendingAmount = result.reduce(
      (acc, invoice) => acc + Number(invoice.pendingAmount || 0),
      0
    );

    res.status(200).json({
      message: "Invoices fetched successfully",
      count: result.length,
      totalPendingAmount,
      invoices: result,
    });
  } catch (error) {
    console.error("[getInvoicesBySalesman] Error:", error);
    res.status(500).json({
      error: "Failed to fetch salesman invoices",
      details: error.message,
    });
  }
};

module.exports = {
  createBilling,
  getAllInvoices,
  deleteInvoice,
  getInvoiceById,
  getInvoicesByCustomer,
  getBalanceByCustomer,
  adjustNewRef,
  updateBilling,
  applyNewRef,
  getInvoicesBySalesman,
};
