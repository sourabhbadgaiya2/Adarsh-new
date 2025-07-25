import React, { useEffect } from "react";
import { Modal, Button, Form } from "react-bootstrap";
import dayjs from "dayjs"; // Import dayjs

const FilterModal = ({
  show,
  onHide,
  onSubmit,
  selectedType,
  setSelectedType,
  startDate,
  setStartDate,
  endDate,
  setEndDate,
}) => {
  useEffect(() => {
    if (!endDate) {
      const today = dayjs().format("YYYY-MM-DD"); // dayjs handles formatting
      setEndDate(today);
    }
  }, [endDate, setEndDate]);

  return (
    <Modal show={show} onHide={onHide} backdrop='static' centered>
      <Modal.Header closeButton>
        <Modal.Title>Select Type & Date</Modal.Title>
      </Modal.Header>
      <Form onSubmit={onSubmit}>
        <Modal.Body>
          <Form.Group className='mb-3'>
            <Form.Label>Type</Form.Label>
            <Form.Select
              value={selectedType}
              onChange={(e) => setSelectedType(e.target.value)}
            >
              <option value=''>Select Type</option>
              <option value='mrwise'>MR Wise</option>
              <option value='areawise'>Area Wise</option>
            </Form.Select>
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label>Start Date (Optional)</Form.Label>
            <Form.Control
              type='date'
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
            />
          </Form.Group>

          <Form.Group className='mb-3'>
            <Form.Label>End Date (Optional)</Form.Label>
            <Form.Control
              type='date'
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
            />
          </Form.Group>
        </Modal.Body>

        <Modal.Footer>
          <Button variant='secondary' onClick={onHide}>
            Close
          </Button>
          <Button variant='primary' type='submit'>
            Next
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  );
};

export default FilterModal;
